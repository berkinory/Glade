import { toastManager } from "../components/ui/toast";

import { useCopyToClipboard } from "../lib/clipboard";

interface CopyToastLabels {
  successTitle: string;

  successDescription: string;
  errorTitle: string;
}

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

export function useCopyPathToClipboard(): (path: string) => void {
  const copy = useCopyWithToasts();
  return (path: string) =>
    copy(path, {
      successTitle: "Path copied",
      successDescription: path,
      errorTitle: "Failed to copy path",
    });
}

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

export function useCopyThreadIdToClipboard(): (threadId: string) => void {
  const copy = useCopyWithToasts();
  return (threadId: string) =>
    copy(threadId, {
      successTitle: "Thread ID copied",
      successDescription: threadId,
      errorTitle: "Failed to copy thread ID",
    });
}
