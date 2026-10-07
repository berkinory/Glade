export type KeyModifier = "Alt" | "Control" | "Meta" | "Shift";

// `key` is a DOM-style key name (Enter, ArrowDown, F5, Space, Shift) or a single character.
export interface KeyChord {
  readonly modifiers: readonly KeyModifier[];
  readonly key: string;
}

export class KeyParseError extends Error {}

const MODIFIER_ORDER: readonly KeyModifier[] = ["Control", "Alt", "Shift", "Meta"];

// "cmd" is the platform's shortcut modifier: Command on macOS, Control elsewhere. Super, win and
// meta always name the OS key.
const MODIFIER_NAMES: Readonly<Record<string, KeyModifier | "Command">> = {
  ctrl: "Control",
  control: "Control",
  ctl: "Control",
  control_l: "Control",
  control_r: "Control",
  alt: "Alt",
  option: "Alt",
  opt: "Alt",
  alt_l: "Alt",
  alt_r: "Alt",
  shift: "Shift",
  shift_l: "Shift",
  shift_r: "Shift",
  meta: "Meta",
  meta_l: "Meta",
  meta_r: "Meta",
  super: "Meta",
  super_l: "Meta",
  super_r: "Meta",
  win: "Meta",
  windows: "Meta",
  cmd: "Command",
  command: "Command",
  "⌘": "Command",
};

// Lowercased DOM names, xdotool keysyms and common shorthands.
const KEY_NAMES: Readonly<Record<string, string>> = {
  enter: "Enter",
  return: "Enter",
  kp_enter: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  ins: "Insert",
  space: "Space",
  spacebar: "Space",
  up: "ArrowUp",
  arrowup: "ArrowUp",
  down: "ArrowDown",
  arrowdown: "ArrowDown",
  left: "ArrowLeft",
  arrowleft: "ArrowLeft",
  right: "ArrowRight",
  arrowright: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  page_up: "PageUp",
  prior: "PageUp",
  pagedown: "PageDown",
  page_down: "PageDown",
  next: "PageDown",
  minus: "-",
  plus: "+",
  equal: "=",
  equals: "=",
  comma: ",",
  period: ".",
  slash: "/",
  backslash: "\\",
  semicolon: ";",
  apostrophe: "'",
  quote: "'",
  grave: "`",
  backtick: "`",
  bracketleft: "[",
  bracketright: "]",
};

function modifierFor(name: string, platform: string): KeyModifier | undefined {
  const modifier = MODIFIER_NAMES[name.toLowerCase()];
  if (modifier === "Command") return platform === "darwin" ? "Meta" : "Control";
  return modifier;
}

function keyFor(name: string, platform: string): string {
  const lower = name.toLowerCase();
  const named = KEY_NAMES[lower];
  if (named) return named;
  if (/^f(?:[1-9]|1[0-2])$/u.test(lower)) return lower.toUpperCase();
  const modifier = modifierFor(name, platform);
  if (modifier) return modifier;
  if ([...name].length === 1) return name;
  throw new KeyParseError(
    `Unknown key "${name}". Use a key name such as Enter, Tab, Escape, ArrowDown, F5 or a single character; type text with browser_type.`,
  );
}

const ordered = (modifiers: Iterable<KeyModifier>) => {
  const set = new Set(modifiers);
  return MODIFIER_ORDER.filter((modifier) => set.has(modifier));
};

function parseChord(chord: string, platform: string): KeyChord {
  // A trailing "+" after a separator is the plus key itself: "ctrl++".
  const plusKey = chord === "+" || chord.endsWith("++");
  const parts = plusKey
    ? [...(chord === "+" ? [] : chord.slice(0, -2).split("+")), "+"]
    : chord.split("+");
  if (parts.some((part) => part === "")) throw new KeyParseError(`Malformed key chord "${chord}".`);
  const modifiers = parts.slice(0, -1).map((part) => {
    const modifier = modifierFor(part, platform);
    if (!modifier) throw new KeyParseError(`Unknown modifier "${part}" in "${chord}".`);
    return modifier;
  });
  let key = keyFor(parts.at(-1)!, platform);
  // "ctrl+A" means the A key, not Shift+A; only an explicit Shift makes it uppercase.
  if (modifiers.length > 0 && /^\p{L}$/u.test(key)) {
    key = modifiers.includes("Shift") ? key.toUpperCase() : key.toLowerCase();
  }
  return { modifiers: ordered(modifiers), key };
}

// Accepts "ctrl+a", "Control+Shift+K", xdotool sequences like "Down Down Return", and key arrays
// like ["CTRL", "A"] (one chord). `platform` is a Node platform name.
export function parseKeys(input: string | readonly string[], platform: string): KeyChord[] {
  if (typeof input !== "string") {
    if (input.length === 0) throw new KeyParseError("No keys given.");
    return [parseChord(input.map((part) => part.trim() || " ").join("+"), platform)];
  }
  if (input.length > 0 && input.trim() === "") return [{ modifiers: [], key: "Space" }];
  const chords = input
    .trim()
    .replace(/\s*\+\s*/gu, "+")
    .split(/\s+/u);
  if (chords[0] === "") throw new KeyParseError("No keys given.");
  return chords.map((chord) => parseChord(chord, platform));
}

// Accepts "ctrl+shift", "Control Shift" or ["ctrl", "shift"].
export function parseModifiers(input: string | readonly string[], platform: string): KeyModifier[] {
  const names = (typeof input === "string" ? [input] : input)
    .flatMap((part) => part.split(/[\s+,]+/u))
    .filter(Boolean);
  return ordered(
    names.map((name) => {
      const modifier = modifierFor(name, platform);
      if (!modifier) throw new KeyParseError(`Unknown modifier "${name}".`);
      return modifier;
    }),
  );
}

export const formatChord = (chord: KeyChord) => [...chord.modifiers, chord.key].join("+");
