import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components";
import { HeadphonesIcon, RefreshCwIcon } from "lucide-react";
import { useApp } from "@/contexts";
import {
  loadOutputDevices,
  OutputDeviceOption,
  persistOutputSelection,
  resolveOutputSelection,
  SYSTEM_DEFAULT_OUTPUT_ID,
} from "@/lib/audio-devices";
import { cn } from "@/lib/utils";

interface OutputDeviceSelectProps {
  disabled?: boolean;
  capturing?: boolean;
  captureUserMic?: boolean;
  className?: string;
}

export function OutputDeviceSelect({
  disabled = false,
  capturing = false,
  captureUserMic = false,
  className,
}: OutputDeviceSelectProps) {
  const { selectedAudioDevices, setSelectedAudioDevices } = useApp();
  const [devices, setDevices] = useState<OutputDeviceOption[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshDevices = useCallback(async () => {
    setLoading(true);
    try {
      const outputDevices = await loadOutputDevices();
      setDevices(outputDevices);

      const resolved = resolveOutputSelection(
        outputDevices,
        selectedAudioDevices.output
      );
      if (resolved.changed) {
        const next = { id: resolved.id, name: resolved.name };
        setSelectedAudioDevices((prev) => ({ ...prev, output: next }));
        persistOutputSelection(next);
      }
    } catch (error) {
      console.error("Failed to load output devices:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedAudioDevices.output, setSelectedAudioDevices]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const handleChange = (deviceId: string) => {
    if (deviceId === SYSTEM_DEFAULT_OUTPUT_ID) {
      const systemDefault = devices.find((d) => d.is_default);
      const next = {
        id: SYSTEM_DEFAULT_OUTPUT_ID,
        name: systemDefault
          ? `System default (${systemDefault.name})`
          : "System default",
      };
      setSelectedAudioDevices((prev) => ({ ...prev, output: next }));
      persistOutputSelection(next);
      return;
    }

    const match = devices.find((d) => d.id === deviceId);
    if (!match) return;

    const next = { id: match.id, name: match.name };
    setSelectedAudioDevices((prev) => ({ ...prev, output: next }));
    persistOutputSelection(next);
  };

  const selectedValue =
    selectedAudioDevices.output.id || SYSTEM_DEFAULT_OUTPUT_ID;

  return (
    <div
      className={cn(
        "rounded-lg border border-border/50 bg-background/80 px-3 py-2",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <HeadphonesIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-xs font-medium">Capture audio from</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {capturing
                ? "Stop and Start again after switching Bluetooth headphones."
                : "Use System default when using Bluetooth — it follows Windows output."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Select
              value={selectedValue}
              onValueChange={handleChange}
              disabled={disabled || loading}
            >
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue
                  placeholder={
                    loading ? "Loading devices..." : "Select output device"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SYSTEM_DEFAULT_OUTPUT_ID}>
                  {devices.find((d) => d.is_default)
                    ? `System default (${devices.find((d) => d.is_default)?.name})`
                    : "System default"}
                </SelectItem>
                {devices.map((device) => (
                  <SelectItem key={device.id} value={device.id}>
                    {device.name}
                    {device.is_default ? " (Windows default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => void refreshDevices()}
              disabled={disabled || loading}
              title="Refresh output devices"
            >
              <RefreshCwIcon
                className={cn("h-3.5 w-3.5", loading && "animate-spin")}
              />
            </Button>
          </div>

          {captureUserMic && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">
              Tip: Turn off &quot;Capture your microphone&quot; on Bluetooth
              during calls — it can block system audio capture on Windows.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
