// Pluely windows speaker input and stream
use super::AudioDevice;
use anyhow::Result;
use futures_util::Stream;
use std::collections::VecDeque;
use std::sync::{mpsc, Arc, Mutex};
use std::task::{Poll, Waker};
use std::thread;
use std::time::Duration;
use tracing::error;
use wasapi::{
    get_default_device, get_default_device_for_role, DeviceCollection, Direction, Role, SampleType,
    StreamMode, WaveFormat,
};
use tracing::info;

pub fn get_input_devices() -> Result<Vec<AudioDevice>> {
    let mut devices = Vec::new();

    let default_device = get_default_device(&Direction::Capture).ok();
    let default_id = default_device.as_ref().and_then(|d| d.get_id().ok());

    let collection = DeviceCollection::new(&Direction::Capture)?;
    let count = collection.get_nbr_devices()?;

    for i in 0..count {
        if let Ok(device) = collection.get_device_at_index(i) {
            let name = device
                .get_friendlyname()
                .unwrap_or_else(|_| format!("Microphone {}", i));
            let id = device
                .get_id()
                .unwrap_or_else(|_| format!("windows_input_{}", i));
            let is_default = default_id.as_ref().map(|def| def == &id).unwrap_or(false);

            devices.push(AudioDevice {
                id,
                name,
                is_default,
            });
        }
    }

    Ok(devices)
}

pub fn get_output_devices() -> Result<Vec<AudioDevice>> {
    let mut devices = Vec::new();

    let default_device = get_default_device(&Direction::Render).ok();
    let default_id = default_device.as_ref().and_then(|d| d.get_id().ok());

    let collection = DeviceCollection::new(&Direction::Render)?;
    let count = collection.get_nbr_devices()?;

    for i in 0..count {
        if let Ok(device) = collection.get_device_at_index(i) {
            let name = device
                .get_friendlyname()
                .unwrap_or_else(|_| format!("Speaker {}", i));
            let id = device
                .get_id()
                .unwrap_or_else(|_| format!("windows_output_{}", i));
            let is_default = default_id.as_ref().map(|def| def == &id).unwrap_or(false);

            devices.push(AudioDevice {
                id,
                name,
                is_default,
            });
        }
    }

    Ok(devices)
}

fn find_device_by_id(direction: &Direction, device_id: &str) -> Option<wasapi::Device> {
    let collection = match DeviceCollection::new(direction) {
        Ok(c) => c,
        Err(e) => {
            error!(
                "[find_device_by_id] Failed to create device collection: {}",
                e
            );
            return None;
        }
    };

    let count = match collection.get_nbr_devices() {
        Ok(c) => c,
        Err(e) => {
            error!("[find_device_by_id] Failed to get device count: {}", e);
            return None;
        }
    };

    for i in 0..count {
        if let Ok(device) = collection.get_device_at_index(i) {
            if let Ok(id) = device.get_id() {
                if id == device_id {
                    return Some(device);
                }
            }
        }
    }

    error!(
        "[find_device_by_id] No matching device found for ID: {}",
        device_id
    );
    None
}

fn resolve_loopback_device(device_id: Option<&str>) -> Result<wasapi::Device> {
    if let Some(id) = device_id.filter(|id| !id.is_empty() && *id != "default") {
        if let Some(device) = find_device_by_id(&Direction::Render, id) {
            let name = device
                .get_friendlyname()
                .unwrap_or_else(|_| "unknown".to_string());
            info!("Pluely loopback using selected output device: {}", name);
            return Ok(device);
        }
        error!(
            "[resolve_loopback_device] Selected device {} not found; using Windows default",
            id
        );
    }

    let device = get_default_device(&Direction::Render)?;
    let name = device
        .get_friendlyname()
        .unwrap_or_else(|_| "unknown".to_string());
    info!("Pluely loopback using console default: {}", name);
    Ok(device)
}

fn communications_loopback_fallback() -> Option<wasapi::Device> {
    let console = get_default_device(&Direction::Render).ok()?;
    let console_id = console.get_id().ok()?;
    let comm = get_default_device_for_role(&Direction::Render, &Role::Communications).ok()?;
    let comm_id = comm.get_id().ok()?;
    if comm_id == console_id {
        return None;
    }
    let comm_name = comm
        .get_friendlyname()
        .unwrap_or_else(|_| "unknown".to_string());
    info!(
        "Pluely loopback retrying with communications default: {}",
        comm_name
    );
    Some(comm)
}

pub struct SpeakerInput {
    device_id: Option<String>,
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        // Store the device_id for later use in stream()
        let device_id = device_id.filter(|id| !id.is_empty() && id != "default");
        Ok(Self { device_id })
    }

    // Starts the audio stream
    pub fn stream(self) -> SpeakerStream {
        let sample_queue = Arc::new(Mutex::new(VecDeque::new()));
        let waker_state = Arc::new(Mutex::new(WakerState {
            waker: None,
            has_data: false,
            shutdown: false,
        }));
        let (init_tx, init_rx) = mpsc::channel();

        let queue_clone = sample_queue.clone();
        let waker_clone = waker_state.clone();
        let device_id = self.device_id;

        let capture_thread = thread::spawn(move || {
            if let Err(e) =
                SpeakerStream::capture_audio_loop(queue_clone, waker_clone, init_tx, device_id)
            {
                error!("Pluely Audio capture loop failed: {}", e);
            }
        });

        let actual_sample_rate = match init_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(rate)) => rate,
            Ok(Err(e)) => {
                error!("Pluely Audio initialization failed: {}", e);
                44100
            }
            Err(_) => {
                error!("Pluely Audio initialization timeout");
                44100
            }
        };

        SpeakerStream {
            sample_queue,
            waker_state,
            capture_thread: Some(capture_thread),
            actual_sample_rate,
        }
    }
}

struct WakerState {
    waker: Option<Waker>,
    has_data: bool,
    shutdown: bool,
}

pub struct SpeakerStream {
    sample_queue: Arc<Mutex<VecDeque<f32>>>,
    waker_state: Arc<Mutex<WakerState>>,
    capture_thread: Option<thread::JoinHandle<()>>,
    actual_sample_rate: u32,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.actual_sample_rate
    }

    fn capture_audio_loop(
        sample_queue: Arc<Mutex<VecDeque<f32>>>,
        waker_state: Arc<Mutex<WakerState>>,
        init_tx: mpsc::Sender<Result<u32>>,
        device_id: Option<String>,
    ) -> Result<()> {
        let init_result = (|| -> Result<_> {
            let try_open = |device: wasapi::Device| -> Result<_> {
                let mut audio_client = device.get_iaudioclient()?;
                let device_format = audio_client.get_mixformat()?;
                let actual_rate = device_format.get_samplespersec();
                let desired_format = WaveFormat::new(
                    32,
                    32,
                    &SampleType::Float,
                    actual_rate as usize,
                    1,
                    None,
                );
                let (_def_time, min_time) = audio_client.get_device_period()?;
                let mode = StreamMode::EventsShared {
                    autoconvert: true,
                    buffer_duration_hns: min_time,
                };
                audio_client.initialize_client(&desired_format, &Direction::Capture, &mode)?;
                let h_event = audio_client.set_get_eventhandle()?;
                let render_client = audio_client.get_audiocaptureclient()?;
                audio_client.start_stream()?;
                Ok((h_event, render_client, actual_rate))
            };

            let primary = resolve_loopback_device(device_id.as_deref())?;
            match try_open(primary) {
                Ok(stream) => Ok(stream),
                Err(primary_err) => {
                    if let Some(fallback) = communications_loopback_fallback() {
                        try_open(fallback).map_err(|fallback_err| {
                            anyhow::anyhow!(
                                "loopback init failed (primary: {}; communications fallback: {})",
                                primary_err,
                                fallback_err
                            )
                        })
                    } else {
                        Err(primary_err)
                    }
                }
            }
        })();

        match init_result {
            Ok((h_event, render_client, sample_rate)) => {
                let _ = init_tx.send(Ok(sample_rate));

                loop {
                    {
                        let state = waker_state.lock().unwrap();
                        if state.shutdown {
                            break;
                        }
                    }

                    // Silence does not emit WASAPI events; keep listening instead of stopping.
                    if h_event.wait_for_event(3000).is_err() {
                        continue;
                    }

                    let mut temp_queue = VecDeque::new();
                    if let Err(e) = render_client.read_from_device_to_deque(&mut temp_queue) {
                        error!("Pluely Failed to read audio data: {}", e);
                        continue;
                    }

                    if temp_queue.is_empty() {
                        continue;
                    }

                    let mut samples = Vec::new();
                    while temp_queue.len() >= 4 {
                        let bytes = [
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                        ];
                        let sample = f32::from_le_bytes(bytes);
                        samples.push(sample);
                    }

                    if !samples.is_empty() {
                        // Consistent buffer overflow handling
                        let dropped = {
                            let mut queue = sample_queue.lock().unwrap();
                            let max_buffer_size = 131072; // 128KB buffer (matching macOS)

                            queue.extend(samples.iter());

                            // If buffer exceeds maximum, drop oldest samples
                            let dropped_count = if queue.len() > max_buffer_size {
                                let to_drop = queue.len() - max_buffer_size;
                                queue.drain(0..to_drop);
                                to_drop
                            } else {
                                0
                            };

                            dropped_count
                        };

                        if dropped > 0 {
                            error!("Windows buffer overflow - dropped {} samples", dropped);
                        }

                        // Wake up consumer
                        {
                            let mut state = waker_state.lock().unwrap();
                            if !state.has_data {
                                state.has_data = true;
                                if let Some(waker) = state.waker.take() {
                                    drop(state);
                                    waker.wake();
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                let _ = init_tx.send(Err(e));
                return Ok(());
            }
        }

        Ok(())
    }
}

// Drops the audio stream
impl Drop for SpeakerStream {
    fn drop(&mut self) {
        {
            let mut state = self.waker_state.lock().unwrap();
            state.shutdown = true;
        }

        if let Some(thread) = self.capture_thread.take() {
            if let Err(e) = thread.join() {
                error!("Failed to join capture thread: {:?}", e);
            }
        }
    }
}

/// Microphone capture (WASAPI Capture direction).
pub struct MicInput {
    device_id: Option<String>,
}

impl MicInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        let device_id = device_id.filter(|id| !id.is_empty() && id != "default");
        Ok(Self { device_id })
    }

    pub fn stream(self) -> MicStream {
        let sample_queue = Arc::new(Mutex::new(VecDeque::new()));
        let waker_state = Arc::new(Mutex::new(WakerState {
            waker: None,
            has_data: false,
            shutdown: false,
        }));
        let (init_tx, init_rx) = mpsc::channel();

        let queue_clone = sample_queue.clone();
        let waker_clone = waker_state.clone();
        let device_id = self.device_id;

        let capture_thread = thread::spawn(move || {
            if let Err(e) =
                MicStream::capture_audio_loop(queue_clone, waker_clone, init_tx, device_id)
            {
                error!("Pluely mic capture loop failed: {}", e);
            }
        });

        let actual_sample_rate = match init_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(rate)) => rate,
            Ok(Err(e)) => {
                error!("Pluely mic initialization failed: {}", e);
                {
                    let mut state = waker_state.lock().unwrap();
                    state.shutdown = true;
                }
                44100
            }
            Err(_) => {
                error!("Pluely mic initialization timeout");
                {
                    let mut state = waker_state.lock().unwrap();
                    state.shutdown = true;
                }
                44100
            }
        };

        MicStream {
            sample_queue,
            waker_state,
            capture_thread: Some(capture_thread),
            actual_sample_rate,
        }
    }
}

pub struct MicStream {
    sample_queue: Arc<Mutex<VecDeque<f32>>>,
    waker_state: Arc<Mutex<WakerState>>,
    capture_thread: Option<thread::JoinHandle<()>>,
    actual_sample_rate: u32,
}

impl MicStream {
    pub fn sample_rate(&self) -> u32 {
        self.actual_sample_rate
    }

    fn capture_audio_loop(
        sample_queue: Arc<Mutex<VecDeque<f32>>>,
        waker_state: Arc<Mutex<WakerState>>,
        init_tx: mpsc::Sender<Result<u32>>,
        device_id: Option<String>,
    ) -> Result<()> {
        let init_result = (|| -> Result<_> {
            let device = match device_id {
                Some(ref id) => match find_device_by_id(&Direction::Capture, id) {
                    Some(d) => d,
                    None => {
                        get_default_device(&Direction::Capture).expect("No default capture device")
                    }
                },
                None => get_default_device(&Direction::Capture)?,
            };

            let mut audio_client = device.get_iaudioclient()?;
            let device_format = audio_client.get_mixformat()?;
            let actual_rate = device_format.get_samplespersec();
            let desired_format =
                WaveFormat::new(32, 32, &SampleType::Float, actual_rate as usize, 1, None);
            let (_def_time, min_time) = audio_client.get_device_period()?;
            let mode = StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: min_time,
            };
            audio_client.initialize_client(&desired_format, &Direction::Capture, &mode)?;
            let h_event = audio_client.set_get_eventhandle()?;
            let capture_client = audio_client.get_audiocaptureclient()?;
            audio_client.start_stream()?;
            Ok((h_event, capture_client, actual_rate))
        })();

        match init_result {
            Ok((h_event, capture_client, sample_rate)) => {
                let _ = init_tx.send(Ok(sample_rate));
                loop {
                    {
                        let state = waker_state.lock().unwrap();
                        if state.shutdown {
                            break;
                        }
                    }
                    if h_event.wait_for_event(3000).is_err() {
                        continue;
                    }
                    let mut temp_queue = VecDeque::new();
                    if let Err(e) = capture_client.read_from_device_to_deque(&mut temp_queue) {
                        error!("Pluely mic failed to read audio data: {}", e);
                        continue;
                    }
                    if temp_queue.is_empty() {
                        continue;
                    }
                    let mut samples = Vec::new();
                    while temp_queue.len() >= 4 {
                        let bytes = [
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                        ];
                        samples.push(f32::from_le_bytes(bytes));
                    }
                    if !samples.is_empty() {
                        let dropped = {
                            let mut queue = sample_queue.lock().unwrap();
                            let max_buffer_size = 131072;
                            queue.extend(samples.iter());
                            if queue.len() > max_buffer_size {
                                let to_drop = queue.len() - max_buffer_size;
                                queue.drain(0..to_drop);
                                to_drop
                            } else {
                                0
                            }
                        };
                        if dropped > 0 {
                            error!("Windows mic buffer overflow - dropped {} samples", dropped);
                        }
                        let mut state = waker_state.lock().unwrap();
                        if !state.has_data {
                            state.has_data = true;
                            if let Some(waker) = state.waker.take() {
                                drop(state);
                                waker.wake();
                            }
                        }
                    }
                }
            }
            Err(e) => {
                let _ = init_tx.send(Err(e));
                {
                    let mut state = waker_state.lock().unwrap();
                    state.shutdown = true;
                }
            }
        }
        Ok(())
    }
}

impl Drop for MicStream {
    fn drop(&mut self) {
        {
            let mut state = self.waker_state.lock().unwrap();
            state.shutdown = true;
        }
        if let Some(thread) = self.capture_thread.take() {
            let _ = thread.join();
        }
    }
}

impl Stream for MicStream {
    type Item = f32;

    fn poll_next(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        {
            let state = self.waker_state.lock().unwrap();
            if state.shutdown {
                return Poll::Ready(None);
            }
        }
        {
            let mut queue = self.sample_queue.lock().unwrap();
            if let Some(sample) = queue.pop_front() {
                return Poll::Ready(Some(sample));
            }
        }
        {
            let mut state = self.waker_state.lock().unwrap();
            if state.shutdown {
                return Poll::Ready(None);
            }
            state.has_data = false;
            state.waker = Some(cx.waker().clone());
        }
        {
            let mut queue = self.sample_queue.lock().unwrap();
            match queue.pop_front() {
                Some(sample) => Poll::Ready(Some(sample)),
                None => Poll::Pending,
            }
        }
    }
}

// Stream of f32 audio samples from the speaker
impl Stream for SpeakerStream {
    type Item = f32;

    // Polls the audio stream
    fn poll_next(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        {
            let state = self.waker_state.lock().unwrap();
            if state.shutdown {
                return Poll::Ready(None);
            }
        }

        {
            let mut queue = self.sample_queue.lock().unwrap();
            if let Some(sample) = queue.pop_front() {
                return Poll::Ready(Some(sample));
            }
        }

        {
            let mut state = self.waker_state.lock().unwrap();
            if state.shutdown {
                return Poll::Ready(None);
            }
            state.has_data = false;
            state.waker = Some(cx.waker().clone());
            drop(state);
        }

        {
            let mut queue = self.sample_queue.lock().unwrap();
            match queue.pop_front() {
                Some(sample) => Poll::Ready(Some(sample)),
                None => Poll::Pending,
            }
        }
    }
}
