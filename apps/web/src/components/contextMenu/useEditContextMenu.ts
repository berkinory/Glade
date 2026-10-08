import type { DesktopEditCommand } from "@glade/contracts/ipc/ipc";
import { useEffect } from "react";
import {
  ClipboardPasteIcon,
  Copy01Icon,
  Image01Icon,
  Scissor01Icon,
  TextSelectionIcon,
} from "~/lib/icons";
import { type ContextMenuItem, showContextMenu } from "./contextMenuStore";

type EditMenuId = DesktopEditCommand | "copy-image";

const TEXT_INPUT_TYPES = new Set([
  "",
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
]);

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function findEditableTarget(target: Element): EditableTarget | null {
  const element = target.closest("input, textarea, [contenteditable]");
  if (element instanceof HTMLTextAreaElement) return element.readOnly ? null : element;
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(element.type) && !element.readOnly ? element : null;
  }
  return element instanceof HTMLElement && element.isContentEditable ? element : null;
}

function hasEditableSelection(editable: EditableTarget): boolean {
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    return (editable.selectionStart ?? 0) !== (editable.selectionEnd ?? 0);
  }
  return document.getSelection()?.isCollapsed === false;
}

// The menu popup takes focus, so the edit target's focus and selection are put back before the
// native command runs against whatever is focused.
function captureEditFocus(editable: EditableTarget): () => void {
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd } = editable;
    return () => {
      editable.focus({ preventScroll: true });
      if (selectionStart !== null && selectionEnd !== null) {
        editable.setSelectionRange(selectionStart, selectionEnd);
      }
    };
  }
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
    : [];
  return () => {
    editable.focus({ preventScroll: true });
    if (!selection || ranges.length === 0) return;
    selection.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
  };
}

function resolveEditMenuItems(
  editable: EditableTarget | null,
  image: HTMLImageElement | null,
): ContextMenuItem<EditMenuId>[] {
  if (editable) {
    const hasSelection = hasEditableSelection(editable);
    return [
      { id: "cut", label: "Cut", icon: Scissor01Icon, disabled: !hasSelection },
      { id: "copy", label: "Copy", icon: Copy01Icon, disabled: !hasSelection },
      { id: "paste", label: "Paste", icon: ClipboardPasteIcon },
      { id: "selectAll", label: "Select All", icon: TextSelectionIcon, separatorBefore: true },
    ];
  }
  const selectedText = document.getSelection()?.toString().trim() ?? "";
  return [
    ...(image ? [{ id: "copy-image" as const, label: "Copy Image", icon: Image01Icon }] : []),
    ...(selectedText ? [{ id: "copy" as const, label: "Copy", icon: Copy01Icon }] : []),
  ];
}

/** Desktop only: Electron shows no menu of its own, so text editing and copying get ours. */
export function useEditContextMenu(): void {
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const handleContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const editable = findEditableTarget(event.target);
      const image = event.target instanceof HTMLImageElement ? event.target : null;
      const items = resolveEditMenuItems(editable, image);
      if (items.length === 0) return;
      event.preventDefault();

      const restoreFocus = editable ? captureEditFocus(editable) : null;
      const position = { x: event.clientX, y: event.clientY };
      void showContextMenu(items, position).then((clicked) => {
        if (!clicked) return;
        if (clicked === "copy-image") {
          // copyImageAt hit-tests the page, so wait for the menu's backdrop to leave the DOM.
          requestAnimationFrame(() => void bridge.copyImageAt(position));
          return;
        }
        restoreFocus?.();
        void bridge.editCommand(clicked);
      });
    };

    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);
}
