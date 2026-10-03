export function hasOpenKeyboardOverlay(except?: Element | null): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    ),
  ).some((element) => {
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
