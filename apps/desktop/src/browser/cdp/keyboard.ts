import {
  KeyParseError,
  parseKeys,
  parseModifiers,
  type KeyChord,
  type KeyModifier,
} from "./keyChords";
import { BrowserFailure } from "../browserFailure";
import type { CdpSession } from "./cdpSession";

export interface KeyDefinition {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly text?: string;
}

const MODIFIER_BITS: Record<KeyModifier, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const MODIFIER_KEYS: Record<KeyModifier, KeyDefinition> = {
  Alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
  Control: { key: "Control", code: "ControlLeft", keyCode: 17 },
  Meta: { key: "Meta", code: "MetaLeft", keyCode: 91 },
  Shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
};

const NAMED_KEYS: Record<string, KeyDefinition> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  Insert: { key: "Insert", code: "Insert", keyCode: 45 },
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `F${index + 1}`,
      { key: `F${index + 1}`, code: `F${index + 1}`, keyCode: 112 + index },
    ]),
  ),
};

export function characterKey(char: string): KeyDefinition {
  const named = char === "\n" || char === "\r" ? NAMED_KEYS.Enter : undefined;
  if (named) return named;
  const upper = char.toUpperCase();
  const code = /^[A-Z]$/u.test(upper) ? `Key${upper}` : /^[0-9]$/u.test(char) ? `Digit${char}` : "";
  return { key: char, code, keyCode: code ? upper.charCodeAt(0) : 0, text: char };
}

// A key name from the shared key parser: a named key, a modifier, or one character.
export function keyDefinition(name: string): KeyDefinition {
  return (
    NAMED_KEYS[name] ??
    (name in MODIFIER_KEYS ? MODIFIER_KEYS[name as KeyModifier] : characterKey(name))
  );
}

function invalidInput<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof KeyParseError) throw new BrowserFailure("invalid_input", error.message);
    throw error;
  }
}

// "cmd" follows the platform the page runs on, which is this desktop's.
export const keyChords = (input: string | readonly string[]): KeyChord[] =>
  invalidInput(() => parseKeys(input, process.platform));
export const keyModifiers = (input: string | readonly string[] | undefined): KeyModifier[] =>
  input === undefined ? [] : invalidInput(() => parseModifiers(input, process.platform));

export function modifierMask(modifiers: readonly KeyModifier[]): number {
  return modifiers.reduce((mask, modifier) => mask | MODIFIER_BITS[modifier], 0);
}

export function modifierKey(modifier: KeyModifier): KeyDefinition {
  return MODIFIER_KEYS[modifier];
}

// On macOS, Chromium runs editing shortcuts in the browser process, so synthetic key events need
// the command named explicitly; elsewhere the renderer maps the keys itself.
const MAC_EDITING_COMMANDS: Readonly<Record<string, string>> = {
  "Meta+a": "selectAll",
  "Meta+z": "undo",
  "Shift+Meta+Z": "redo",
};

export function editingCommands(chord: KeyChord): string[] {
  if (process.platform !== "darwin") return [];
  const command = MAC_EDITING_COMMANDS[[...chord.modifiers, chord.key].join("+")];
  return command ? [command] : [];
}

export async function pressKey(
  cdp: CdpSession,
  definition: KeyDefinition,
  modifiers: number,
  commands: readonly string[] = [],
) {
  const text = modifiers & ~8 ? undefined : definition.text;
  const base = {
    key: definition.key,
    code: definition.code,
    windowsVirtualKeyCode: definition.keyCode,
    modifiers,
  };
  await cdp.send("Input.dispatchKeyEvent", {
    ...base,
    type: text ? "keyDown" : "rawKeyDown",
    ...(text ? { text, unmodifiedText: text } : {}),
    ...(commands.length > 0 ? { commands } : {}),
  });
  await cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}
