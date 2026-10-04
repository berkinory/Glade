import { shortcutEventKey, type ShortcutKeyboardEvent } from "@glade/shared/settings/shortcutEvent";
import type { KeybindingShortcut } from "@glade/contracts/settings/keybindings";

import { getNavigatorPlatform, isMacPlatform } from "~/lib/utils";

// Modifiers are deliberately excluded here because the final keydown event already exposes the
// complete modifier state.
function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup") return "arrowup";
  if (normalized === "arrowdown") return "arrowdown";
  if (normalized === "arrowleft") return "arrowleft";
  if (normalized === "arrowright") return "arrowright";
  if (Array.from(normalized).length === 1 || normalized === "i\u0307") return normalized;
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(normalized)) return normalized;
  if (
    normalized === "enter" ||
    normalized === "tab" ||
    normalized === "backspace" ||
    normalized === "delete" ||
    normalized === "home" ||
    normalized === "end" ||
    normalized === "pageup" ||
    normalized === "pagedown"
  ) {
    return normalized;
  }
  return null;
}

export function keybindingFromKeyboardEvent(
  event: ShortcutKeyboardEvent,
  platform = getNavigatorPlatform(),
): string | null {
  const key = shortcutEventKey(event);
  const keyToken = key === null ? null : normalizeShortcutKeyToken(key);
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(platform)) {
    if (event.metaKey) parts.push("mod");
    if (event.ctrlKey) parts.push("ctrl");
  } else {
    if (event.ctrlKey) parts.push("mod");
    if (event.metaKey) parts.push("meta");
  }
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(keyToken);

  return parts.length <= 3 ? parts.join("+") : null;
}

export function keybindingValueFromShortcut(shortcut: KeybindingShortcut): string {
  const parts: string[] = [];
  if (shortcut.modKey) parts.push("mod");
  if (shortcut.ctrlKey) parts.push("ctrl");
  if (shortcut.metaKey) parts.push("meta");
  if (shortcut.altKey) parts.push("alt");
  if (shortcut.shiftKey) parts.push("shift");
  parts.push(shortcut.key === " " ? "space" : shortcut.key === "escape" ? "esc" : shortcut.key);
  return parts.join("+");
}
