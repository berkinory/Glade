import { useState } from "react";
import { useDesktopWindowMaterial } from "~/hooks/useDesktopWindowMaterial";
import { Switch } from "~/components/ui/switch";
import { SettingsRow } from "./SettingsPanelPrimitives";

export function WindowMaterialSettingsRow() {
  const material = useDesktopWindowMaterial();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!material.supported && !material.error) return null;

  async function change(enabled: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await material.setEnabled(enabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsRow
      title="Window transparency"
      description="Use native macOS vibrancy or Windows 11 Mica across the window. Off by default."
      status={error ?? material.error ?? undefined}
      control={
        <Switch
          checked={material.enabled}
          disabled={busy || !material.supported}
          onCheckedChange={(enabled) => void change(Boolean(enabled))}
          aria-label="Window transparency"
        />
      }
    />
  );
}
