import type { BrowserModifier } from "@glade/contracts/browser/browserTools";
import { BrowserFailure } from "../browserFailure";
import type { CdpSession } from "./cdpSession";

export interface KeyDefinition {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly text?: string;
}

const MODIFIER_BITS: Record<BrowserModifier, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const MODIFIER_KEYS: Record<BrowserModifier, KeyDefinition> = {
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
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `F${index + 1}`,
      { key: `F${index + 1}`, code: `F${index + 1}`, keyCode: 112 + index },
    ]),
  ),
};

const ALIASES: Record<string, string> = {
  ctrl: "Control",
  control: "Control",
  cmd: "Meta",
  command: "Meta",
  meta: "Meta",
  super: "Meta",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  esc: "Escape",
  return: "Enter",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  del: "Delete",
  " ": "Space",
};

function canonical(name: string): string {
  const alias = ALIASES[name.toLowerCase()];
  if (alias) return alias;
  const named = Object.keys(NAMED_KEYS).find((key) => key.toLowerCase() === name.toLowerCase());
  return named ?? name;
}

export function characterKey(char: string): KeyDefinition {
  const named = char === "\n" || char === "\r" ? NAMED_KEYS.Enter : undefined;
  if (named) return named;
  const upper = char.toUpperCase();
  const code = /^[A-Z]$/u.test(upper) ? `Key${upper}` : /^[0-9]$/u.test(char) ? `Digit${char}` : "";
  return { key: char, code, keyCode: code ? upper.charCodeAt(0) : 0, text: char };
}

export interface KeyChord {
  readonly modifiers: readonly BrowserModifier[];
  readonly modifierMask: number;
  readonly key: KeyDefinition;
}

// "Control+Shift+A", "Enter", "cmd+k": modifiers first, then exactly one key.
export function parseKeyChord(chord: string): KeyChord {
  const parts = chord === "+" ? ["+"] : chord.split("+").map((part) => part.trim() || "+");
  const keyName = canonical(parts.at(-1)!);
  const modifiers = parts.slice(0, -1).map((part) => {
    const name = canonical(part);
    if (!(name in MODIFIER_BITS)) {
      throw new BrowserFailure("invalid_input", `Unknown modifier "${part}" in "${chord}".`);
    }
    return name as BrowserModifier;
  });
  const named =
    NAMED_KEYS[keyName] ??
    (keyName in MODIFIER_KEYS ? MODIFIER_KEYS[keyName as BrowserModifier] : undefined);
  if (!named && [...keyName].length !== 1) {
    throw new BrowserFailure(
      "invalid_input",
      `Unknown key "${keyName}". Use a single character or a key name such as Enter, Tab, Escape, ArrowDown.`,
    );
  }
  return { modifiers, modifierMask: modifierMask(modifiers), key: named ?? characterKey(keyName) };
}

export function modifierMask(modifiers: readonly BrowserModifier[]): number {
  return modifiers.reduce((mask, modifier) => mask | MODIFIER_BITS[modifier], 0);
}

export function modifierKey(modifier: BrowserModifier): KeyDefinition {
  return MODIFIER_KEYS[modifier];
}

export async function pressKey(cdp: CdpSession, definition: KeyDefinition, modifiers: number) {
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
  });
  await cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}
