import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type LexicalNode,
} from "lexical";
import {
  ComposerLinkNode,
  ComposerBrowserElementNode,
  ComposerTerminalContextNode,
  ComposerMentionNode,
  ComposerSkillNode,
  ComposerAgentMentionNode,
  isComposerInlineTokenNode,
  type ComposerInlineTokenNode,
} from "./composer-nodes";

export function clampExpandedCursor(value: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return value.length;
  return Math.max(0, Math.min(value.length, Math.floor(cursor)));
}

function getComposerInlineTokenTextLength(node: ComposerInlineTokenNode, expanded = false): number {
  return expanded ? node.getTextContentSize() : 1;
}

function getAbsoluteOffsetForInlineTokenPoint(
  node: ComposerInlineTokenNode,
  absoluteOffset: number,
  pointOffset: number,
  expanded: boolean,
): number {
  return absoluteOffset + (pointOffset > 0 ? getComposerInlineTokenTextLength(node, expanded) : 0);
}

function findSelectionPointForInlineToken(
  node: ComposerInlineTokenNode,
  remainingRef: { value: number },
): { key: string; offset: number; type: "element" } | null {
  const parent = node.getParent();
  if (!parent || !$isElementNode(parent)) return null;
  const index = node.getIndexWithinParent();
  if (remainingRef.value === 0) {
    return {
      key: parent.getKey(),
      offset: index,
      type: "element",
    };
  }
  if (remainingRef.value === getComposerInlineTokenTextLength(node)) {
    return {
      key: parent.getKey(),
      offset: index + 1,
      type: "element",
    };
  }
  remainingRef.value -= getComposerInlineTokenTextLength(node);
  return null;
}

function getComposerNodeTextLength(node: LexicalNode, expanded = false): number {
  if (isComposerInlineTokenNode(node)) {
    return getComposerInlineTokenTextLength(node, expanded);
  }
  if ($isTextNode(node)) return node.getTextContentSize();
  if ($isLineBreakNode(node)) return 1;
  if ($isElementNode(node)) {
    return node
      .getChildren()
      .reduce((total, child) => total + getComposerNodeTextLength(child, expanded), 0);
  }
  return 0;
}

function getAbsoluteOffsetForPointInternal(
  node: LexicalNode,
  pointOffset: number,
  expanded: boolean,
): number {
  let offset = 0;
  let current: LexicalNode | null = node;
  while (current) {
    const nextParent = current.getParent() as LexicalNode | null;
    if (!nextParent || !$isElementNode(nextParent)) break;
    const siblings = nextParent.getChildren();
    const index = current.getIndexWithinParent();
    for (let i = 0; i < index; i += 1) {
      const sibling = siblings[i];
      if (sibling) offset += getComposerNodeTextLength(sibling, expanded);
    }
    current = nextParent;
  }

  if (
    node instanceof ComposerLinkNode ||
    node instanceof ComposerBrowserElementNode ||
    node instanceof ComposerTerminalContextNode
  ) {
    return getAbsoluteOffsetForInlineTokenPoint(node, offset, pointOffset, expanded);
  }
  if ($isTextNode(node)) {
    if (
      node instanceof ComposerMentionNode ||
      node instanceof ComposerSkillNode ||
      node instanceof ComposerAgentMentionNode
    ) {
      return getAbsoluteOffsetForInlineTokenPoint(node, offset, pointOffset, expanded);
    }
    return offset + Math.min(pointOffset, node.getTextContentSize());
  }
  if ($isLineBreakNode(node)) return offset + Math.min(pointOffset, 1);
  if ($isElementNode(node)) {
    const children = node.getChildren();
    const clampedOffset = Math.max(0, Math.min(pointOffset, children.length));
    for (let i = 0; i < clampedOffset; i += 1) {
      const child = children[i];
      if (child) offset += getComposerNodeTextLength(child, expanded);
    }
  }
  return offset;
}

export function getAbsoluteOffsetForPoint(node: LexicalNode, pointOffset: number): number {
  return getAbsoluteOffsetForPointInternal(node, pointOffset, false);
}

function getExpandedAbsoluteOffsetForPoint(node: LexicalNode, pointOffset: number): number {
  return getAbsoluteOffsetForPointInternal(node, pointOffset, true);
}

function findSelectionPointAtOffset(
  node: LexicalNode,
  remainingRef: { value: number },
): { key: string; offset: number; type: "text" | "element" } | null {
  if (
    node instanceof ComposerMentionNode ||
    node instanceof ComposerSkillNode ||
    node instanceof ComposerAgentMentionNode ||
    node instanceof ComposerLinkNode ||
    node instanceof ComposerBrowserElementNode ||
    node instanceof ComposerTerminalContextNode
  ) {
    return findSelectionPointForInlineToken(node, remainingRef);
  }

  if ($isTextNode(node)) {
    const size = node.getTextContentSize();
    if (remainingRef.value <= size) {
      return {
        key: node.getKey(),
        offset: remainingRef.value,
        type: "text",
      };
    }
    remainingRef.value -= size;
    return null;
  }

  if ($isLineBreakNode(node)) {
    const parent = node.getParent();
    if (!parent) return null;
    const index = node.getIndexWithinParent();
    if (remainingRef.value === 0) {
      return {
        key: parent.getKey(),
        offset: index,
        type: "element",
      };
    }
    if (remainingRef.value === 1) {
      return {
        key: parent.getKey(),
        offset: index + 1,
        type: "element",
      };
    }
    remainingRef.value -= 1;
    return null;
  }

  if ($isElementNode(node)) {
    const children = node.getChildren();
    for (const child of children) {
      const point = findSelectionPointAtOffset(child, remainingRef);
      if (point) {
        return point;
      }
    }
    if (remainingRef.value === 0) {
      return {
        key: node.getKey(),
        offset: children.length,
        type: "element",
      };
    }
  }

  return null;
}

export function $getComposerRootLength(): number {
  const root = $getRoot();
  const children = root.getChildren();
  return children.reduce((sum, child) => sum + getComposerNodeTextLength(child), 0);
}

export function $setSelectionAtComposerOffset(nextOffset: number): void {
  const root = $getRoot();
  const composerLength = $getComposerRootLength();
  const boundedOffset = Math.max(0, Math.min(nextOffset, composerLength));
  const remainingRef = { value: boundedOffset };
  const point = findSelectionPointAtOffset(root, remainingRef) ?? {
    key: root.getKey(),
    offset: root.getChildren().length,
    type: "element" as const,
  };
  const selection = $createRangeSelection();
  selection.anchor.set(point.key, point.offset, point.type);
  selection.focus.set(point.key, point.offset, point.type);
  $setSelection(selection);
}

export function $readSelectionOffsetFromEditorState(fallback: number): number {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return fallback;
  }
  const anchorNode = selection.anchor.getNode();
  const offset = getAbsoluteOffsetForPoint(anchorNode, selection.anchor.offset);
  const composerLength = $getComposerRootLength();
  return Math.max(0, Math.min(offset, composerLength));
}

export function $readExpandedSelectionOffsetFromEditorState(fallback: number): number {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return fallback;
  }
  const anchorNode = selection.anchor.getNode();
  const offset = getExpandedAbsoluteOffsetForPoint(anchorNode, selection.anchor.offset);
  const expandedLength = $getRoot().getTextContent().length;
  return Math.max(0, Math.min(offset, expandedLength));
}
