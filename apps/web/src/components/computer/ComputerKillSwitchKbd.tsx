import { isElectron } from "~/env";
import { formatShortcutLabel } from "~/keybindings";
import { getNavigatorPlatform, isMacPlatform } from "~/lib/utils";
import { ShortcutKbd } from "../ui/kbd";

// The desktop registers this chord system-wide (apps/desktop/src/computer/computerKillSwitch.ts);
// the two must name the same keys.
function computerKillSwitchLabel(platform: string): string {
  const isMac = isMacPlatform(platform);
  return formatShortcutLabel(
    {
      key: "escape",
      ctrlKey: true,
      altKey: true,
      metaKey: isMac,
      shiftKey: !isMac,
      modKey: false,
    },
    platform,
  );
}

export function ComputerKillSwitchKbd() {
  return <ShortcutKbd shortcutLabel={computerKillSwitchLabel(getNavigatorPlatform())} />;
}

// The composer's reminder that the shortcut stops Computer Use from any app; desktop only, since
// only the desktop registers it.
export function ComputerKillSwitchHint() {
  if (!isElectron) return null;
  return (
    <span className="hidden shrink-0 sm:inline-flex" title="Stops Computer Use from any app">
      <ComputerKillSwitchKbd />
    </span>
  );
}
