import { toastManager } from "../components/ui/toast";

import { useCopyToClipboard } from "../lib/clipboard";

interface CopyToastLabels {
  successTitle: string;
  /** Shown under the success title — usually the thing that was copied. */
  successDescription: string;
  errorTitle: string;
}

/**
 * Shared "copy + toast" plumbing behind every copy-X convenience hook below:
 * one success/error toast shape, one place to change it.
 */
function useCopyWithToasts(): (value: string, labels: CopyToastLabels) => void {
  const { copyToClipboard } = useCopyToClipboard<CopyToastLabels>({
    onCopy: (labels) =>
      toastManager.add({
        type: "success",
        title: labels.successTitle,
        description: labels.successDescription,
      }),
    onError: (error, labels) =>
      toastManager.add({
        type: "error",
        title: labels.errorTitle,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
  });
  return copyToClipboard;
}

/**
 * Copy a filesystem path and surface the shared success/error toast. Single source
 * of truth for the "Path copied" affordance used by the sidebar and the kanban board.
 */
export function useCopyPathToClipboard(): (path: string) => void {
  const copy = useCopyWithToasts();
  return (path: string) =>
    copy(path, {
      successTitle: "Path copied",
      successDescription: path,
      errorTitle: "Failed to copy path",
    });
}

/**
 * Copy a previewed file's text contents and surface the shared success/error
 * toast. Single source of truth for the "Copy contents" affordance in the
 * file-preview header's overflow menu. Empty files get an informational toast
 * instead of a copy (the clipboard helper never writes empty strings), and
 * `partial: true` (large files whose preview holds a truncated read) is called
 * out so the success toast never claims more than what was copied.
 */
export function useCopyFileContentsToClipboard(): (
  contents: string,
  fileName: string,
  options?: { partial?: boolean },
) => void {
  const copy = useCopyWithToasts();
  return (contents: string, fileName: string, options?: { partial?: boolean }) => {
    if (contents.length === 0) {
      toastManager.add({ type: "info", title: "Nothing to copy", description: "File is empty" });
      return;
    }
    copy(
      contents,
      options?.partial
        ? {
            successTitle: "Partial contents copied",
            successDescription: "Large file — only the loaded part was copied",
            errorTitle: "Failed to copy contents",
          }
        : {
            successTitle: "Contents copied",
            successDescription: fileName,
            errorTitle: "Failed to copy contents",
          },
    );
  };
}

/** Copy a thread id and surface the shared "Thread ID copied" toast. */
export function useCopyThreadIdToClipboard(): (threadId: string) => void {
  const copy = useCopyWithToasts();
  return (threadId: string) =>
    copy(threadId, {
      successTitle: "Thread ID copied",
      successDescription: threadId,
      errorTitle: "Failed to copy thread ID",
    });
}
