import { SettingsRow } from "../settings/SettingsPanelPrimitives";
import { Switch } from "../ui/switch";
import { useBrowserContentBlocker } from "./useBrowserContentBlocker";

export function BrowserContentBlockerRow() {
  const blocker = useBrowserContentBlocker();
  if (!blocker.available) return null;

  return (
    <SettingsRow
      id="setting-browser-content-blocker"
      title="Block ads, trackers and cookie notices"
      description="Applies to Glade's built-in browser, for you and the agent. Turn it off for one site with the shield in the browser panel. Filter lists refresh daily; pages pick up a change on their next load."
      status={blocker.error ?? undefined}
      control={
        <Switch
          checked={blocker.enabled ?? true}
          disabled={blocker.enabled === undefined}
          onCheckedChange={(next) => void blocker.setEnabled(Boolean(next))}
          aria-label="Block ads, trackers and cookie notices"
        />
      }
    />
  );
}
