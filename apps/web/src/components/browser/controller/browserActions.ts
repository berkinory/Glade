import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ThreadBrowserState } from "@glade/contracts/ipc/ipc";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@glade/contracts/orchestration/threadEntities";
import { resolveCopyableBrowserTabUrl } from "@glade/shared/browser/browserSession";
import { BROWSER_COPY_LINK_TOAST_TITLE } from "@glade/shared/browser/browserShortcuts";
import { useBrowserStateStore } from "~/browserStateStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { anchoredToastManager, toastManager } from "~/components/ui/toast";
import { isElectron } from "~/env";
import { prepareComposerImageFromBrowserScreenshot } from "~/lib/browserPromptContext";
import { readNativeApi } from "~/nativeApi";
import { formatBrowserActionError } from "./browserPanelSupport";

type ReportError = (error: string | null) => void;
type BrowserCommand =
  | { kind: "back" | "forward" | "reload" | "select" | "close"; tabId: string }
  | { kind: "new" }
  | { kind: "navigate"; url: string; tabId?: string };

export async function runBrowserOperation<T>(
  operation: () => Promise<T>,
  reportError: ReportError,
): Promise<T | null> {
  try {
    const result = await operation();
    reportError(null);
    return result;
  } catch (error) {
    reportError(formatBrowserActionError(error));
    return null;
  }
}

export async function runBrowserCommand(
  threadId: ThreadId,
  command: BrowserCommand,
  reportError: ReportError,
): Promise<ThreadBrowserState | null> {
  const api = readNativeApi();
  if (!api) return null;
  const result = await runBrowserOperation(() => {
    switch (command.kind) {
      case "back":
        return api.browser.goBack({ threadId, tabId: command.tabId });
      case "forward":
        return api.browser.goForward({ threadId, tabId: command.tabId });
      case "reload":
        return api.browser.reload({ threadId, tabId: command.tabId });
      case "select":
        return api.browser.selectTab({ threadId, tabId: command.tabId });
      case "close":
        return api.browser.closeTab({ threadId, tabId: command.tabId });
      case "new":
        return api.browser.newTab({ threadId, activate: true });
      case "navigate":
        return api.browser.navigate({
          threadId,
          url: command.url,
          ...(command.tabId ? { tabId: command.tabId } : {}),
        });
    }
  }, reportError);
  if (result) useBrowserStateStore.getState().upsertThreadState(result);
  return result;
}

export async function captureBrowserScreenshot(
  threadId: ThreadId,
  tabId: string,
  reportError: ReportError,
): Promise<void> {
  const api = readNativeApi();
  if (!api) return;
  const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
  const count =
    (draft?.images.length ?? 0) +
    (draft?.files.length ?? 0) +
    (draft?.assistantSelections.length ?? 0);
  const limitError = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`;
  if (count >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    reportError(limitError);
    return;
  }
  const screenshot = await runBrowserOperation(
    () => api.browser.captureScreenshot({ threadId, tabId }),
    reportError,
  );
  if (!screenshot) return;
  try {
    const image = await prepareComposerImageFromBrowserScreenshot(screenshot);
    if (!useComposerDraftStore.getState().addImage(threadId, image)) throw new Error(limitError);
    reportError(null);
  } catch (error) {
    reportError(
      error instanceof Error ? error.message : "The browser screenshot could not be prepared.",
    );
  }
}

export async function copyBrowserScreenshot(
  threadId: ThreadId,
  tabId: string,
  resolveAnchor: () => HTMLElement | null,
  reportError: ReportError,
): Promise<void> {
  const api = readNativeApi();
  if (!api) return;
  const result = await runBrowserOperation(
    () => api.browser.copyScreenshotToClipboard({ threadId, tabId }),
    reportError,
  );
  if (result === null) return;
  const anchor = resolveAnchor();
  if (anchor) {
    anchoredToastManager.add({
      data: { tooltipStyle: true },
      positionerProps: { anchor },
      timeout: 1_200,
      title: "Browser screenshot copied",
    });
  } else {
    toastManager.add({ type: "success", title: "Browser screenshot copied" });
  }
}

export async function copyBrowserLink(
  threadId: ThreadId,
  tabId: string,
  reportError: ReportError,
): Promise<void> {
  const api = readNativeApi();
  if (isElectron && api) {
    await runBrowserOperation(() => api.browser.copyLink({ threadId, tabId }), reportError);
    return;
  }
  const tab = useBrowserStateStore
    .getState()
    .threadStatesByThreadId[threadId]?.tabs.find((tab) => tab.id === tabId);
  if (!tab) return;
  const url = resolveCopyableBrowserTabUrl(tab);
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!url || !clipboard) return;
  await clipboard.writeText(url).then(
    () => {
      toastManager.add({ type: "success", title: BROWSER_COPY_LINK_TOAST_TITLE });
    },
    () => {},
  );
}
