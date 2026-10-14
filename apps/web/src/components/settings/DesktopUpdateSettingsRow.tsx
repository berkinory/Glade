import { Button } from "~/components/ui/button";
import { useUpdates } from "~/components/UpdateProvider";
import { SettingsRow } from "./SettingsPanelPrimitives";

export function DesktopUpdateSettingsRow() {
  const { updateButton } = useUpdates();
  if (!window.desktopBridge) return null;

  return (
    <SettingsRow
      title="Updates"
      description={updateButton.tooltip}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={updateButton.disabled}
          onClick={updateButton.onClick}
        >
          {updateButton.label}
          {updateButton.downloadPercent !== null ? ` ${updateButton.downloadPercent}%` : ""}
        </Button>
      }
    />
  );
}
