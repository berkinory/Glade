import { CHAT_ASSISTANT_SELECTION_TEXT_MAX_CHARS } from "@glade/contracts/orchestration/threadEntities";
import { type ThreadId } from "@glade/contracts/core/baseSchemas";

import { requestComposerFocus, useComposerDraftStore } from "../composerDraftStore";
import { formatComposerMentionToken } from "./composerMentions";
import { createFileCommentDraft, type FileCommentSelection } from "./fileComments";
import { type PullRequestContextDraft } from "./pullRequestContext";

export interface ChatFileReference {
  path: string;
  startLine?: number;
  endLine?: number;

  startColumn?: number;
  endColumn?: number;

  snippet?: string;
}

export const CHAT_FILE_REFERENCE_DRAG_TYPE = "application/x-glade-file-reference";

function formatLineRangeLabel(startLine: number, endLine: number): string {
  return endLine !== startLine ? `lines ${startLine}-${endLine}` : `line ${startLine}`;
}

function fenceCodeSnippet(snippet: string): string {
  const normalized = snippet.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
  const truncated =
    normalized.length > CHAT_ASSISTANT_SELECTION_TEXT_MAX_CHARS
      ? normalized.slice(0, CHAT_ASSISTANT_SELECTION_TEXT_MAX_CHARS)
      : normalized;
  const longestBacktickRun = truncated
    .match(/`+/g)
    ?.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, (longestBacktickRun ?? 0) + 1));
  return `${fence}\n${truncated}\n${fence}`;
}

export function formatSelectionLabel(reference: ChatFileReference): string | null {
  if (typeof reference.startLine !== "number") {
    return null;
  }
  const endLine = reference.endLine ?? reference.startLine;
  const { startColumn, endColumn } = reference;
  if (typeof startColumn !== "number" || typeof endColumn !== "number") {
    return formatLineRangeLabel(reference.startLine, endLine);
  }
  if (reference.startLine === endLine) {
    const columns = startColumn === endColumn ? `${startColumn}` : `${startColumn}-${endColumn}`;
    return `line ${reference.startLine}:${columns}`;
  }
  return `lines ${reference.startLine}:${startColumn}-${endLine}:${endColumn}`;
}

export function formatChatFileReference(reference: ChatFileReference): string {
  const token = formatComposerMentionToken(reference.path);
  const label = formatSelectionLabel(reference);
  if (label) {
    return `${token} (${label})`;
  }
  if (reference.snippet !== undefined && reference.snippet.trim().length > 0) {
    return `${token}\n${fenceCodeSnippet(reference.snippet)}`;
  }
  return token;
}

export function buildWhyLinesPrompt(reference: ChatFileReference): string {
  const token = formatComposerMentionToken(reference.path);
  if (typeof reference.startLine !== "number") {
    return `Why did we implement ${token} this way? Check the git history if needed and explain the reasoning.`;
  }
  const endLine = reference.endLine ?? reference.startLine;
  return `Why were ${formatLineRangeLabel(reference.startLine, endLine)} in ${token} implemented this way? Check git blame/history for the relevant commits and explain the reasoning.`;
}

export function appendComposerPromptText(threadId: ThreadId, text: string): void {
  const store = useComposerDraftStore.getState();
  const existingPrompt = store.draftsByThreadId[threadId]?.prompt ?? "";
  const needsSeparator = existingPrompt.length > 0 && !/\s$/.test(existingPrompt);
  store.setPrompt(threadId, `${existingPrompt}${needsSeparator ? " " : ""}${text} `);

  requestComposerFocus(threadId);
}

export function appendChatFileReference(threadId: ThreadId, reference: ChatFileReference): void {
  appendComposerPromptText(threadId, formatChatFileReference(reference));
}

export function addChatFileComment(threadId: ThreadId, comment: FileCommentSelection): boolean {
  const draft = createFileCommentDraft(comment);
  if (!draft) {
    return false;
  }
  useComposerDraftStore.getState().addFileComment(threadId, draft);
  requestComposerFocus(threadId);
  return true;
}

export function addChatPullRequestContext(
  threadId: ThreadId,
  context: PullRequestContextDraft,
): boolean {
  const added = useComposerDraftStore.getState().addPullRequestContext(threadId, context);
  if (added) {
    requestComposerFocus(threadId);
  }
  return added;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      count += 1;
    }
  }
  return count;
}

function columnsOnLastLine(text: string): number {
  return text.length - (text.lastIndexOf("\n") + 1);
}

function computeSelectionLineRange(
  prefixText: string,
  selectedText: string,
): { startLine: number; endLine: number } {
  const startLine = countNewlines(prefixText) + 1;
  const endLine = startLine + countNewlines(selectedText.replace(/\n+$/, ""));
  return { startLine, endLine };
}

function computeSelectionColumns(
  prefixText: string,
  selectedText: string,
): { startColumn: number; endColumn: number } {
  const startColumn = columnsOnLastLine(prefixText) + 1;
  const trimmedSelection = selectedText.replace(/\n+$/, "");
  const endColumn = columnsOnLastLine(prefixText + trimmedSelection);
  return { startColumn, endColumn };
}

export interface SelectionWithin {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

function getSelectionRangeWithin(
  container: HTMLElement,
): { selection: Selection; range: Range; selectedText: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }
  const selectedText = range.toString();
  if (selectedText.trim().length === 0) {
    return null;
  }
  return { selection, range, selectedText };
}

// Works for both plain <pre> contents and Shiki-highlighted markup because both keep one "\n" of
// text content per rendered line.
export function getSelectionWithin(container: HTMLElement): SelectionWithin | null {
  const scoped = getSelectionRangeWithin(container);
  if (!scoped) {
    return null;
  }
  const prefixRange = document.createRange();
  prefixRange.selectNodeContents(container);
  prefixRange.setEnd(scoped.range.startContainer, scoped.range.startOffset);
  const prefixText = prefixRange.toString();
  return {
    ...computeSelectionLineRange(prefixText, scoped.selectedText),
    ...computeSelectionColumns(prefixText, scoped.selectedText),
  };
}

export function getSelectionSnippetWithin(container: HTMLElement): { snippet: string } | null {
  const scoped = getSelectionRangeWithin(container);
  if (!scoped) {
    return null;
  }

  const snippet = normalizeSelectionSnippet(scoped.selection.toString());
  return snippet === null ? null : { snippet };
}

function normalizeSelectionSnippet(text: string): string | null {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/^\n+|\n+$/g, "")
    .trim();
  return normalized.length === 0 ? null : normalized;
}
