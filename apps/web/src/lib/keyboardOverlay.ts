const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

// Open dialogs, menus and listboxes, wherever they are mounted.
export function visibleOverlayElements(except?: Element | null): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)).filter((element) => {
    if (element === except || except?.contains(element)) return false;
    if (element.closest('[inert], [hidden], [aria-hidden="true"], [data-state="closed"]'))
      return false;
    const style = getComputedStyle(element);
    return (
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      element.getClientRects().length > 0
    );
  });
}

export function hasOpenKeyboardOverlay(except?: Element | null): boolean {
  if (document.activeElement?.hasAttribute("data-keybinding-capture")) return true;
  // Toasts are non-modal notifications; a lingering one must not swallow shortcuts. They still
  // count as overlays for native view placement.
  return visibleOverlayElements(except).some(
    (element) => !element.closest('[data-slot="toast-viewport"]'),
  );
}
