import { useLocalDesktopActive } from "~/environments/activeEnvironment";
import { getNavigatorPlatform } from "~/lib/utils";
import { computerKillSwitchLabel } from "~/shortcutsSheet";
import { ShortcutKbd } from "../ui/kbd";

// The composer's reminder that the shortcut stops Computer Use from any app; desktop only, since
// only the desktop registers it.
export function ComputerKillSwitchHint() {
  const isLocalDesktop = useLocalDesktopActive();
  if (!isLocalDesktop) return null;
  return (
    <span className="hidden shrink-0 sm:inline-flex" title="Stops Computer Use from any app">
      <ShortcutKbd shortcutLabel={computerKillSwitchLabel(getNavigatorPlatform())} />
    </span>
  );
}
