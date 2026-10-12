import { useEffect, useEffectEvent } from "react";
import { isMacNavigatorPlatform } from "~/lib/utils";

export const MODEL_PICKER_POPUP_ATTRIBUTE = "data-model-picker-popup";
export const TRAITS_PICKER_POPUP_ATTRIBUTE = "data-traits-picker-popup";

const PICKER_POPUP_SELECTOR = `[${MODEL_PICKER_POPUP_ATTRIBUTE}], [${TRAITS_PICKER_POPUP_ATTRIBUTE}]`;
const ROW_SHORTCUT_LIMIT = 9;

export function findOpenComposerPickerPopup(): HTMLElement | null {
  return typeof document === "undefined"
    ? null
    : document.querySelector<HTMLElement>(PICKER_POPUP_SELECTOR);
}

// While a composer picker is open it owns mod+1…9, so the sidebar's thread jump and its hints yield.
export function isComposerPickerShortcutScopeActive(): boolean {
  return findOpenComposerPickerPopup() !== null;
}

export function composerPickerRowShortcutLabel(index: number): string | null {
  if (index >= ROW_SHORTCUT_LIMIT) return null;
  return `${isMacNavigatorPlatform() ? "⌘" : "Ctrl "}${index + 1}`;
}

function rowShortcutIndex(event: KeyboardEvent): number | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return null;
  if (!/^[1-9]$/u.test(event.key)) return null;
  return Number(event.key) - 1;
}

// Registered on window capture because thread jump owns the same chord globally.
export function useComposerPickerRowShortcuts(open: boolean, onPickRow: (index: number) => void) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const index = rowShortcutIndex(event);
    if (index === null) return;
    event.preventDefault();
    event.stopPropagation();
    onPickRow(index);
  });
  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener, { capture: true });
    return () => window.removeEventListener("keydown", listener, { capture: true });
  }, [open]);
}
