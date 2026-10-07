import type { ComposerFileAttachment, ComposerImageAttachment } from "../../composerDraftDomain";
import { formatAssistantSelectionQueuePreview } from "../../lib/assistantSelections";
import { pastedTextTitle, type PastedTextDraft } from "../../lib/composerPastedText";
import { formatFileCommentLabel, type FileCommentDraft } from "../../lib/fileComments";
import {
  formatPullRequestContextTitleSeed,
  type PullRequestContextDraft,
} from "../../lib/pullRequestContext";
import { formatTerminalContextLabel, type TerminalContextDraft } from "../../lib/terminalContext";

export function buildQueuedComposerPreviewText(input: {
  trimmedPrompt: string;
  images: ReadonlyArray<ComposerImageAttachment>;
  files: ReadonlyArray<ComposerFileAttachment>;
  assistantSelections: ReadonlyArray<{ id: string }>;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  fileComments: ReadonlyArray<FileCommentDraft>;
  pastedTexts: ReadonlyArray<PastedTextDraft>;
  pullRequestContexts: ReadonlyArray<PullRequestContextDraft>;
}): string {
  if (input.trimmedPrompt.length > 0) {
    return input.trimmedPrompt;
  }
  const firstImage = input.images[0];
  if (firstImage) {
    return `Image: ${firstImage.name}`;
  }
  const firstFile = input.files[0];
  if (firstFile) {
    return `File: ${firstFile.name}`;
  }
  if (input.assistantSelections.length > 0) {
    return formatAssistantSelectionQueuePreview(input.assistantSelections.length);
  }
  const firstTerminalContext = input.terminalContexts[0];
  if (firstTerminalContext) {
    return formatTerminalContextLabel(firstTerminalContext);
  }
  const firstFileComment = input.fileComments[0];
  if (firstFileComment) {
    return formatFileCommentLabel(firstFileComment);
  }
  const pastedTitle = formatPastedTextTitleSeed(input.pastedTexts);
  if (pastedTitle) {
    return pastedTitle;
  }
  const pullRequestTitle = formatPullRequestContextTitleSeed(input.pullRequestContexts);
  if (pullRequestTitle) {
    return pullRequestTitle;
  }
  return "Queued follow-up";
}

export function formatPastedTextTitleSeed(
  pastedTexts: ReadonlyArray<PastedTextDraft>,
): string | null {
  const firstPastedText = pastedTexts[0];
  if (!firstPastedText) {
    return null;
  }
  return pastedTexts.length === 1
    ? pastedTextTitle(firstPastedText.text)
    : `${pastedTexts.length} pasted texts`;
}
