// Key text as models write it ("cmd+s", "Control+Shift+K", xdotool's "Return" or "super+c", and
// space-separated sequences like "Down Down Return") as Cua calls: press_key for a single key,
// hotkey for a chord. The browser has its own CDP parser in the desktop app; the vocabularies
// differ (DOM key names there, Cua's key names here).

type CuaKeyCall =
  | { readonly tool: "press_key"; readonly args: { readonly key: string } }
  | { readonly tool: "hotkey"; readonly args: { readonly keys: ReadonlyArray<string> } };

const MAX_CHORDS = 16;

// "cmd" is the platform's shortcut modifier (Command on macOS, Control elsewhere); super, meta and
// win always name the OS key, which Cua calls cmd.
const MODIFIERS: Readonly<Record<string, string>> = {
  ctrl: "ctrl",
  control: "ctrl",
  ctl: "ctrl",
  control_l: "ctrl",
  control_r: "ctrl",
  alt: "option",
  option: "option",
  opt: "option",
  alt_l: "option",
  alt_r: "option",
  shift: "shift",
  shift_l: "shift",
  shift_r: "shift",
  super: "cmd",
  super_l: "cmd",
  super_r: "cmd",
  meta: "cmd",
  meta_l: "cmd",
  meta_r: "cmd",
  win: "cmd",
  fn: "fn",
};
const SHORTCUT_MODIFIERS = new Set(["cmd", "command", "⌘"]);

// Cua's key names for DOM names, xdotool keysyms and common shorthands. A Mac's Backspace key is
// Cua's "delete".
const KEYS: Readonly<Record<string, string>> = {
  enter: "return",
  return: "return",
  kp_enter: "return",
  tab: "tab",
  escape: "escape",
  esc: "escape",
  backspace: "delete",
  delete: "delete",
  del: "delete",
  space: "space",
  spacebar: "space",
  up: "up",
  arrowup: "up",
  down: "down",
  arrowdown: "down",
  left: "left",
  arrowleft: "left",
  right: "right",
  arrowright: "right",
  home: "home",
  end: "end",
  pageup: "pageup",
  page_up: "pageup",
  prior: "pageup",
  pagedown: "pagedown",
  page_down: "pagedown",
  next: "pagedown",
};

const modifierFor = (name: string) => {
  const lower = name.toLowerCase();
  if (SHORTCUT_MODIFIERS.has(lower)) return process.platform === "darwin" ? "cmd" : "ctrl";
  return MODIFIERS[lower];
};

const keyFor = (name: string) => {
  const lower = name.toLowerCase();
  if (KEYS[lower]) return KEYS[lower];
  if (/^f(?:[1-9]|1[0-2])$/u.test(lower)) return lower;
  if ([...name].length === 1) return lower;
  return null;
};

function parseChord(chord: string): CuaKeyCall | string {
  // A trailing "+" after a separator is the plus key itself: "cmd++".
  const parts =
    chord === "+"
      ? ["+"]
      : chord.endsWith("++")
        ? [...chord.slice(0, -2).split("+"), "+"]
        : chord.split("+");
  if (parts.some((part) => part === "")) return `Malformed key chord "${chord}".`;
  const modifiers: string[] = [];
  for (const part of parts.slice(0, -1)) {
    const modifier = modifierFor(part);
    if (!modifier) return `Unknown modifier "${part}" in "${chord}".`;
    if (!modifiers.includes(modifier)) modifiers.push(modifier);
  }
  const last = parts.at(-1)!;
  const key = keyFor(last);
  if (key === null) {
    return `Unknown key "${last}". Use return, tab, escape, delete, space, up, down, left, right, home, end, pageup, pagedown, f1-f12 or one character; type text with computer_type.`;
  }
  return modifiers.length > 0
    ? { tool: "hotkey", args: { keys: [...modifiers, key] } }
    : { tool: "press_key", args: { key } };
}

// The Cua calls for key text in order, or why it cannot be pressed.
export function keyCalls(text: string): ReadonlyArray<CuaKeyCall> | string {
  if (text.length > 0 && text.trim() === "") return [{ tool: "press_key", args: { key: "space" } }];
  const chords = text
    .trim()
    .replace(/\s*\+\s*/gu, "+")
    .split(/\s+/u)
    .filter(Boolean);
  if (chords.length === 0) return "No keys given.";
  if (chords.length > MAX_CHORDS) return `At most ${MAX_CHORDS} keys per call.`;
  const calls: CuaKeyCall[] = [];
  for (const chord of chords) {
    const call = parseChord(chord);
    if (typeof call === "string") return call;
    calls.push(call);
  }
  return calls;
}
