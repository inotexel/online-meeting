#[cfg(target_os = "macos")]
use tauri::LogicalPosition;
use tauri::{App, AppHandle, Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

// The offset from the top of the screen to the window
const TOP_OFFSET: i32 = 54;

/// Sets up the main window with custom positioning
pub fn setup_main_window(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    // Try different possible window labels
    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("pluely"))
        .or_else(|| {
            // Get the first window if specific labels don't work
            app.webview_windows().values().next().cloned()
        })
        .ok_or("No window found")?;

    position_window_top_center(&window, TOP_OFFSET)?;

    // Set window as non-focusable on Windows
    // #[cfg(target_os = "windows")]
    // {
    //     let _ = window.set_focusable(false);
    // }

    Ok(())
}

/// Positions a window at the top center of the screen with a specified Y offset
pub fn position_window_top_center(
    window: &WebviewWindow,
    y_offset: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    // Get the primary monitor
    if let Some(monitor) = window.primary_monitor()? {
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;

        // Calculate center X position
        let center_x = (monitor_size.width as i32 - window_size.width as i32) / 2;

        // Set the window position
        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: center_x,
            y: y_offset,
        }))?;
    }

    Ok(())
}

/// Future function for centering window completely (both X and Y)
#[allow(dead_code)]
pub fn center_window_completely(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(monitor) = window.primary_monitor()? {
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;

        let center_x = (monitor_size.width as i32 - window_size.width as i32) / 2;
        let center_y = (monitor_size.height as i32 - window_size.height as i32) / 2;

        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: center_x,
            y: center_y,
        }))?;
    }

    Ok(())
}

#[tauri::command]
pub fn set_overlay_content_protected(
    app: tauri::AppHandle,
    protected: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found".to_string())?;

    window
        .set_content_protected(protected)
        .map_err(|e| format!("Failed to set content protection: {}", e))
}

const ORIGINAL_OVERLAY_WIDTH: f64 = 600.0;
const COMPACT_OVERLAY_HEIGHT: f64 = 54.0;
const DEFAULT_EXPANDED_HEIGHT: f64 = 600.0;

fn active_monitor(window: &WebviewWindow) -> Result<tauri::Monitor, String> {
    window
        .current_monitor()
        .or_else(|_| window.primary_monitor())
        .map_err(|e| format!("Failed to get monitor: {}", e))?
        .ok_or_else(|| "No monitor found".to_string())
}

fn monitor_logical_size(monitor: &tauri::Monitor) -> (f64, f64) {
    let size = monitor.size();
    let scale = monitor.scale_factor();
    (
        size.width as f64 / scale,
        size.height as f64 / scale,
    )
}

fn monitor_logical_origin(monitor: &tauri::Monitor) -> (f64, f64) {
    let position = monitor.position();
    let scale = monitor.scale_factor();
    (
        position.x as f64 / scale,
        position.y as f64 / scale,
    )
}

/// `mode`: `compact` | `fit` | `original` | `fullscreen`
#[tauri::command]
pub fn set_overlay_layout(
    window: tauri::WebviewWindow,
    mode: String,
    height: Option<u32>,
) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize, Position, Size};

    match mode.as_str() {
        "compact" => {
            window
                .set_size(Size::Logical(LogicalSize::new(
                    ORIGINAL_OVERLAY_WIDTH,
                    COMPACT_OVERLAY_HEIGHT,
                )))
                .map_err(|e| format!("Failed to resize window: {}", e))?;
            position_window_top_center(&window, TOP_OFFSET)
                .map_err(|e| e.to_string())?;
        }
        "original" => {
            let expanded_height = height
                .map(|h| h as f64)
                .unwrap_or(DEFAULT_EXPANDED_HEIGHT);
            window
                .set_size(Size::Logical(LogicalSize::new(
                    ORIGINAL_OVERLAY_WIDTH,
                    expanded_height,
                )))
                .map_err(|e| format!("Failed to resize window: {}", e))?;
            position_window_top_center(&window, TOP_OFFSET)
                .map_err(|e| e.to_string())?;
        }
        "fit" => {
            let monitor = active_monitor(&window)?;
            let (logical_w, logical_h) = monitor_logical_size(&monitor);
            let fit_w = logical_w * 0.96;
            let fit_h = logical_h * 0.92;
            window
                .set_size(Size::Logical(LogicalSize::new(fit_w, fit_h)))
                .map_err(|e| format!("Failed to resize window: {}", e))?;
            position_window_top_center(&window, TOP_OFFSET)
                .map_err(|e| e.to_string())?;
        }
        "fullscreen" => {
            let monitor = active_monitor(&window)?;
            let (logical_w, logical_h) = monitor_logical_size(&monitor);
            let (origin_x, origin_y) = monitor_logical_origin(&monitor);
            window
                .set_size(Size::Logical(LogicalSize::new(logical_w, logical_h)))
                .map_err(|e| format!("Failed to resize window: {}", e))?;
            window
                .set_position(Position::Logical(LogicalPosition::new(
                    origin_x, origin_y,
                )))
                .map_err(|e| format!("Failed to set window position: {}", e))?;
        }
        other => {
            return Err(format!("Invalid overlay layout mode: {}", other));
        }
    }

    Ok(())
}

#[tauri::command]
pub fn set_window_height(window: tauri::WebviewWindow, height: u32) -> Result<(), String> {
    if height <= COMPACT_OVERLAY_HEIGHT as u32 {
        set_overlay_layout(window, "compact".to_string(), None)
    } else {
        set_overlay_layout(window, "original".to_string(), Some(height))
    }
}

#[tauri::command]
pub fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    show_dashboard_window(&app)
}

#[tauri::command]
pub fn toggle_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        match dashboard_window.is_visible() {
            Ok(true) => {
                // Window is visible, hide it
                dashboard_window
                    .hide()
                    .map_err(|e| format!("Failed to hide dashboard window: {}", e))?;
            }
            Ok(false) => {
                // Window is hidden, show and focus it
                dashboard_window
                    .show()
                    .map_err(|e| format!("Failed to show dashboard window: {}", e))?;
                dashboard_window
                    .set_focus()
                    .map_err(|e| format!("Failed to focus dashboard window: {}", e))?;
            }
            Err(e) => {
                return Err(format!("Failed to check dashboard visibility: {}", e));
            }
        }
    } else {
        // Window doesn't exist, create and show it
        show_dashboard_window(&app)?;
    }

    Ok(())
}

#[tauri::command]
pub fn move_window(app: tauri::AppHandle, direction: String, step: i32) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let current_pos = window
            .outer_position()
            .map_err(|e| format!("Failed to get window position: {}", e))?;

        let (new_x, new_y) = match direction.as_str() {
            "up" => (current_pos.x, current_pos.y - step),
            "down" => (current_pos.x, current_pos.y + step),
            "left" => (current_pos.x - step, current_pos.y),
            "right" => (current_pos.x + step, current_pos.y),
            _ => return Err(format!("Invalid direction: {}", direction)),
        };

        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: new_x,
                y: new_y,
            }))
            .map_err(|e| format!("Failed to set window position: {}", e))?;
    } else {
        return Err("Main window not found".to_string());
    }

    Ok(())
}

pub fn create_dashboard_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, tauri::Error> {
    let base_builder =
        WebviewWindowBuilder::new(app, "dashboard", tauri::WebviewUrl::App("/chats".into()));

    #[cfg(target_os = "macos")]
    let base_builder = base_builder
        .title("Closing Coach - Dashboard")
        .center()
        .decorations(true)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .content_protected(true)
        .visible(true)
        .traffic_light_position(LogicalPosition::new(14.0, 18.0));

    #[cfg(not(target_os = "macos"))]
    let base_builder = base_builder
        .title("Closing Coach - Dashboard")
        .center()
        .decorations(true)
        .inner_size(800.0, 600.0)
        .min_inner_size(800.0, 600.0)
        .content_protected(true)
        .visible(false);

    let window = base_builder.build()?;

    // Set up close event handler - hide window instead of destroying it
    setup_dashboard_close_handler(&window);

    Ok(window)
}

/// Sets up the close event handler for the dashboard window
fn setup_dashboard_close_handler<R: Runtime>(window: &WebviewWindow<R>) {
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Prevent the window from being destroyed
            api.prevent_close();
            // Hide the window instead
            if let Err(e) = window_clone.hide() {
                eprintln!("Failed to hide dashboard window on close: {}", e);
            }
        }
    });
}

/// Shows the dashboard window and brings it to focus
pub fn show_dashboard_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        // Window exists, show and focus it
        dashboard_window
            .show()
            .map_err(|e| format!("Failed to show dashboard window: {}", e))?;
        dashboard_window
            .set_focus()
            .map_err(|e| format!("Failed to focus dashboard window: {}", e))?;
    } else {
        // Window doesn't exist, create it and then show it
        let window = create_dashboard_window(app)
            .map_err(|e| format!("Failed to create dashboard window: {}", e))?;
        window
            .show()
            .map_err(|e| format!("Failed to show new dashboard window: {}", e))?;
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus new dashboard window: {}", e))?;
    }
    Ok(())
}
