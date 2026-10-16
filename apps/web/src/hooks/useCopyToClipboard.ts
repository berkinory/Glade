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
      errorTitle: "Could not copy path",
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
      toastManager.add({ type: "info", title: "Nothing to copy", description: "File is empty." });
      return;
    }
    copy(
      contents,
      options?.partial
        ? {
            successTitle: "Partial contents copied",
            successDescription: "Only the loaded part of this large file was copied.",
            errorTitle: "Could not copy contents",
          }
        : {
            successTitle: "Contents copied",
            successDescription: fileName,
            errorTitle: "Could not copy contents",
          },
    );
  };
}

export function useCopyThreadIdToClipboard(): (threadId: string) => void {
  const copy = useCopyWithToasts();
  return (threadId: string) =>
    copy(threadId, {
      successTitle: "Chat ID copied",
      successDescription: threadId,
      errorTitle: "Could not copy chat ID",
    });
}
