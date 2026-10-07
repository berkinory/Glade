import { Schema } from "effect";
import { KeybindingShortcut } from "../settings/keybindings";

export const DESKTOP_MENU_SHORTCUT_COMMANDS = ["terminal.new", "sidebar.toggle"] as const;
export type DesktopMenuShortcutCommand = (typeof DESKTOP_MENU_SHORTCUT_COMMANDS)[number];

export const DesktopMenuShortcuts = Schema.Struct({
  "terminal.new": Schema.NullOr(KeybindingShortcut),
  "sidebar.toggle": Schema.NullOr(KeybindingShortcut),
});
export type DesktopMenuShortcuts = typeof DesktopMenuShortcuts.Type;

export const DesktopMenuShortcutState = Schema.Struct({
  shortcuts: DesktopMenuShortcuts,
  capturing: Schema.Boolean,
});
export type DesktopMenuShortcutState = typeof DesktopMenuShortcutState.Type;
