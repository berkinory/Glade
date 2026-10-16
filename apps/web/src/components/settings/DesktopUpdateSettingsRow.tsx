import { Button } from "~/components/ui/button";
import { useUpdates } from "~/components/updates/UpdateProvider";
import { SettingsRow } from "./SettingsPanelPrimitives";

export function DesktopUpdateSettingsRow() {
  const { desktopUpdate, pill, openUpdates } = useUpdates();
  if (!window.desktopBridge) return null;

  return (
    <SettingsRow
      title="Updates"
      description={pill?.tooltip ?? desktopUpdate.desktopUpdateTooltip}
      control={
        pill ? (
          <Button size="sm" variant="outline" onClick={openUpdates}>
            Review updates
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={
              desktopUpdate.desktopUpdateButtonDisabled ||
              desktopUpdate.desktopUpdateButtonAction === "none"
            }
            onClick={desktopUpdate.handleDesktopUpdateButtonClick}
          >
            {desktopUpdate.desktopUpdateButtonPresentation.label}
          </Button>
        )
      }
    />
  );
}
