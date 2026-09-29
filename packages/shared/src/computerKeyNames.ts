export const COMPUTER_NAMED_KEYS = [
  "escape",
  "enter",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "home",
  "end",
  "pageup",
  "pagedown",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
] as const;

export type ComputerNamedKey = (typeof COMPUTER_NAMED_KEYS)[number];

const NAMED_KEY_SET: ReadonlySet<string> = new Set(COMPUTER_NAMED_KEYS);

export function isComputerNamedKey(name: string): name is ComputerNamedKey {
  return NAMED_KEY_SET.has(name);
}

export const COMPUTER_KEY_NAME_ALIASES: Readonly<Record<string, ComputerNamedKey>> = {
  esc: "escape",
  return: "enter",
  spacebar: "space",
  del: "delete",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
};

// Kept out of `COMPUTER_NAMED_KEYS` because the two readers want opposite things from them: the
// evdev synthesizer needs a code for each so a chord can press them, while the pane must never
// swallow a bare modifier press — the browser needs to see it to keep its own modifier state
// straight.
export const COMPUTER_MODIFIER_KEY_NAMES = [
  "shift",
  "ctrl",
  "control",
  "alt",
  "option",
  "meta",
  "super",
  "command",
  "capslock",
] as const;

export type ComputerModifierKeyName = (typeof COMPUTER_MODIFIER_KEY_NAMES)[number];
