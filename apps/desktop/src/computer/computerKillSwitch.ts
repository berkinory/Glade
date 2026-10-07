import { globalShortcut } from "electron";

// Stops every running Computer Use task from anywhere, even while an agent drives the pointer and
// another app has focus. No default Glade keybinding uses Escape with these modifiers, and macOS
// keeps Cmd+Option+Escape (Force Quit) without Control.
const COMPUTER_KILL_SWITCH_ACCELERATOR =
  process.platform === "darwin" ? "Control+Alt+Command+Escape" : "Control+Alt+Shift+Escape";

export interface ComputerKillSwitch {
  // Registered only while the driver is ready, so Glade holds the system-wide shortcut only when
  // Computer Use can act.
  readonly setEnabled: (enabled: boolean) => void;
  readonly dispose: () => void;
}

export function createComputerKillSwitch(input: {
  readonly onPressed: () => void;
  readonly log: (message: string) => void;
}): ComputerKillSwitch {
  let registered = false;
  const setEnabled = (enabled: boolean) => {
    if (enabled === registered) return;
    if (!enabled) {
      globalShortcut.unregister(COMPUTER_KILL_SWITCH_ACCELERATOR);
      registered = false;
      return;
    }
    registered = globalShortcut.register(COMPUTER_KILL_SWITCH_ACCELERATOR, () => {
      input.log("computer kill switch pressed");
      input.onPressed();
    });
    if (!registered) {
      input.log(`computer kill switch ${COMPUTER_KILL_SWITCH_ACCELERATOR} is taken by another app`);
    }
  };
  return { setEnabled, dispose: () => setEnabled(false) };
}
