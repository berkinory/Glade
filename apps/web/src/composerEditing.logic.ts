import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  replaceTextRange,
  type ComposerTrigger,
} from "./composer-logic";
import {
  ensureLeadingSpaceForReplacement,
  extendReplacementRangeForTrailingSpace,
} from "./composerTriggerInsertion";
import { composerMentionPathNeedsQuoting } from "./lib/composerMentions";

export interface ComposerReplacement {
  text: string;
  cursor: number;
  trigger: ComposerTrigger | null;
}

export function replaceComposerPromptRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
  options?: { expectedText?: string; cursorOffset?: number },
): ComposerReplacement | false {
  const safeStart = Math.max(0, Math.min(text.length, rangeStart));
  const safeEnd = Math.max(safeStart, Math.min(text.length, rangeEnd));
  if (
    options?.expectedText !== undefined &&
    text.slice(safeStart, safeEnd) !== options.expectedText
  ) {
    return false;
  }
  const next = replaceTextRange(text, rangeStart, rangeEnd, replacement);
  const cursor = Math.max(
    0,
    collapseExpandedComposerCursor(next.text, next.cursor) + (options?.cursorOffset ?? 0),
  );
  return {
    text: next.text,
    cursor,
    trigger: detectComposerTrigger(next.text, expandCollapsedComposerCursor(next.text, cursor)),
  };
}

export function replaceComposerTrigger(
  snapshot: { value: string },
  trigger: ComposerTrigger,
  base: string,
  apply: (
    rangeStart: number,
    rangeEnd: number,
    replacement: string,
    options: { expectedText: string; cursorOffset?: number },
  ) => number | false,
  cursorOffset?: number,
): number | false {
  const replacement = ensureLeadingSpaceForReplacement(snapshot.value, trigger.rangeStart, base);
  const rangeEnd = extendReplacementRangeForTrailingSpace(
    snapshot.value,
    trigger.rangeEnd,
    replacement,
  );
  return apply(trigger.rangeStart, rangeEnd, replacement, {
    expectedText: snapshot.value.slice(trigger.rangeStart, rangeEnd),
    ...(cursorOffset === undefined ? {} : { cursorOffset }),
  });
}

export function composerFolderMention(absolutePath: string): string {
  const separator = absolutePath.includes("\\") ? "\\" : "/";
  const withTrailingSeparator = absolutePath.endsWith(separator)
    ? absolutePath
    : `${absolutePath}${separator}`;
  return composerMentionPathNeedsQuoting(withTrailingSeparator)
    ? `@"${withTrailingSeparator}`
    : `@${withTrailingSeparator}`;
}
