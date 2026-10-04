export interface ShortcutKeyboardEvent {
  key: string;
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
  getModifierState?: (key: string) => boolean;
}

const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Space: " ",
};

export function shortcutPhysicalKey(code: string | undefined): string | null {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return PUNCTUATION_CODES[code] ?? null;
}

export function isShortcutComposition(event: ShortcutKeyboardEvent): boolean {
  return (
    event.isComposing === true ||
    event.keyCode === 229 ||
    event.getModifierState?.("AltGraph") === true
  );
}

export function shortcutEventKey(event: ShortcutKeyboardEvent): string | null {
  if (isShortcutComposition(event)) return null;
  const key = event.key.toLowerCase();
  if (["dead", "process", "unidentified", "altgraph"].includes(key)) return null;
  // A layout's typed letter/digit has one identity, never a second physical alias.
  if (/^[\p{L}\p{N}]$/u.test(key) || key === "i\u0307") return key;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    const physical = shortcutPhysicalKey(event.code);
    if (physical) return physical;
  }
  return key === "esc" ? "escape" : key;
}
