import {
  DESKTOP_MENU_SHORTCUT_COMMANDS,
  type DesktopMenuShortcutCommand,
  type DesktopMenuShortcutState,
} from "@glade/contracts/ipc/menuShortcuts";
import type { KeybindingShortcut } from "@glade/contracts/settings/keybindings";
import { shortcutEventKey, shortcutPhysicalKey } from "@glade/shared/settings/shortcutEvent";
import type { DesktopKeyboardInput } from "./menuShortcuts";

const NAMED_KEYS: Readonly<Record<string, string>> = {
  " ": "Space",
  "+": "Plus",
  escape: "Escape",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
};

function accelerator(
  shortcut: KeybindingShortcut | null,
  platform: NodeJS.Platform,
): string | undefined {
  if (!shortcut || platform === "linux") return undefined;
  const key =
    NAMED_KEYS[shortcut.key] ??
    (/^[a-z0-9]$/.test(shortcut.key) || /^f(?:[1-9]|1\d|2[0-4])$/.test(shortcut.key)
      ? shortcut.key.toUpperCase()
      : undefined);
  // Modified punctuation and layout-specific characters cannot be represented faithfully by Electron.
  if (!key || !(shortcut.modKey || shortcut.metaKey || shortcut.ctrlKey)) return undefined;
  const meta = shortcut.metaKey || (shortcut.modKey && platform === "darwin");
  const ctrl = shortcut.ctrlKey || (shortcut.modKey && platform !== "darwin");
  // Native edit, window, help and zoom roles keep their existing precedence.
  if (
    (meta || ctrl) &&
    !shortcut.altKey &&
    ["a", "c", "x", "v", "z", "w", "r", "q", "h", "m", " ", "+", "0"].includes(shortcut.key)
  )
    return undefined;
  if (platform === "win32" && ctrl && shortcut.altKey) return undefined;
  const parts: string[] = [];
  if (meta) parts.push(platform === "darwin" ? "Cmd" : "Super");
  if (ctrl) parts.push("Ctrl");
  if (shortcut.altKey) parts.push("Alt");
  if (shortcut.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

export function createDesktopMenuShortcuts(platform: NodeJS.Platform, changed: () => void) {
  let state: DesktopMenuShortcutState = {
    shortcuts: { "terminal.new": null, "sidebar.toggle": null },
    capturing: false,
  };
  const getAccelerator = (command: DesktopMenuShortcutCommand) =>
    accelerator(state.shortcuts[command], platform);
  const apply = (next: DesktopMenuShortcutState) => {
    const previous = DESKTOP_MENU_SHORTCUT_COMMANDS.map(getAccelerator);
    state = next;
    if (
      DESKTOP_MENU_SHORTCUT_COMMANDS.some(
        (command, index) => getAccelerator(command) !== previous[index],
      )
    )
      changed();
  };
  return {
    apply,
    getAccelerator,
    isCapturing: () => state.capturing,
    reset: () =>
      apply({
        shortcuts: { "terminal.new": null, "sidebar.toggle": null },
        capturing: false,
      }),
    shouldIgnoreNativeShortcut: (
      input: DesktopKeyboardInput & { isComposing?: boolean; modifiers?: string[] },
    ) => {
      if (state.capturing || input.isComposing || input.modifiers?.includes("altgr")) return true;
      const event = {
        key: input.key,
        ...(input.code ? { code: input.code } : {}),
        ctrlKey: input.control,
        metaKey: input.meta,
        altKey: input.alt,
        shiftKey: input.shift,
      };
      return DESKTOP_MENU_SHORTCUT_COMMANDS.some((command) => {
        const shortcut = state.shortcuts[command];
        if (!shortcut || !getAccelerator(command)) return false;
        const meta = shortcut.metaKey || (shortcut.modKey && platform === "darwin");
        const ctrl = shortcut.ctrlKey || (shortcut.modKey && platform !== "darwin");
        return (
          meta === input.meta &&
          ctrl === input.control &&
          shortcut.altKey === input.alt &&
          shortcut.shiftKey === input.shift &&
          (shortcutEventKey(event) === shortcut.key ||
            shortcutPhysicalKey(input.code) === shortcut.key)
        );
      });
    },
  };
}
