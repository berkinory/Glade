import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopUpdateState } from "@glade/contracts/ipc/ipc";
import { isElectron } from "../../env";
import { persistAppStateNow, useStore } from "../../store";
import { listRunningChatsFromDesktopStore } from "../../lib/runningChatsQuitConfirmation";
import { stopLocalRunningChats } from "../../lib/stopRunningChats";
import { DownloadIcon } from "~/lib/icons";
import { toastManager } from "../ui/toast";
import {
  type DesktopUpdateButtonAction,
  type DesktopUpdateButtonPresentation,
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateAlreadyCurrentNotice,
  getDesktopUpdateButtonPresentation,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDownloadPercent,
  getDesktopUpdateErrorSignature,
  isDesktopUpdateButtonDisabled,
  isDesktopUpdateInstallInFlight,
  resolveDesktopUpdateButtonAction,
  shouldRecommendManualDesktopDownload,
  shouldShowArm64IntelBuildWarning,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";

export interface DesktopUpdateControls {
  showDesktopUpdateButton: boolean;
  desktopUpdateTooltip: string;
  desktopUpdateButtonDisabled: boolean;
  desktopUpdateButtonAction: DesktopUpdateButtonAction;
  desktopUpdateButtonPresentation: DesktopUpdateButtonPresentation;
  showArm64IntelBuildWarning: boolean;
  arm64IntelBuildWarningDescription: string | null;
  desktopUpdateDownloadPercent: number | null;
  desktopUpdateReadyVersion: string | null;
  desktopCurrentVersion: string | null;
  installing: boolean;
  handleDesktopUpdateButtonClick: () => void;
}

export function useDesktopUpdate(): DesktopUpdateControls {
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const [installingDesktopUpdate, setInstallingDesktopUpdate] = useState(false);
  const lastDesktopUpdateErrorToastSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [setDesktopUpdateState]);

  const surfaceDesktopUpdateError = useCallback(
    (input: { title: string; description: string; state: DesktopUpdateState | null }) => {
      const signature = getDesktopUpdateErrorSignature(input.state) ?? `adhoc:${input.description}`;
      if (lastDesktopUpdateErrorToastSignatureRef.current === signature) {
        return;
      }
      lastDesktopUpdateErrorToastSignatureRef.current = signature;
      const releaseUrl = input.state?.releaseUrl ?? null;
      const recommendManualDownload = shouldRecommendManualDesktopDownload(input.state);
      const fallbackProps = releaseUrl
        ? {
            data: {
              copyText: releaseUrl,
              actions: [
                {
                  label: "Download manually",
                  icon: DownloadIcon,
                  onClick: () => {
                    void window.desktopBridge?.openExternal(releaseUrl);
                  },
                },
              ],
            },
          }
        : {};
      toastManager.add({
        type: "error",
        title: recommendManualDownload ? "Download the update manually" : input.title,
        description: recommendManualDownload
          ? `Automatic installation has failed ${input.state?.installFailureCount ?? 0} times. Download ${input.state?.availableVersion ?? "the update"} manually to finish updating.`
          : input.description,
        ...fallbackProps,
      });
    },
    [lastDesktopUpdateErrorToastSignatureRef],
  );

  useEffect(() => {
    if (!getDesktopUpdateErrorSignature(desktopUpdateState)) {
      lastDesktopUpdateErrorToastSignatureRef.current = null;
      return;
    }
    if (!desktopUpdateState?.releaseUrl) {
      return;
    }
    surfaceDesktopUpdateError({
      title:
        desktopUpdateState.errorContext === "install"
          ? "Could not finish updating"
          : "Could not download update",
      description:
        desktopUpdateState.message ??
        "The in-app update could not complete. You can download it manually.",
      state: desktopUpdateState,
    });
  }, [desktopUpdateState, surfaceDesktopUpdateError, lastDesktopUpdateErrorToastSignatureRef]);

  useEffect(() => {
    if (
      desktopUpdateState?.status !== "downloaded" ||
      desktopUpdateState.errorContext === "install"
    ) {
      setInstallingDesktopUpdate(false);
    }
  }, [desktopUpdateState?.status, desktopUpdateState?.errorContext, setInstallingDesktopUpdate]);

  const showDesktopUpdateButton = isElectron && shouldShowDesktopUpdateButton(desktopUpdateState);

  const desktopUpdateTooltip = !desktopUpdateState
    ? "Loading update status…"
    : !desktopUpdateState.enabled
      ? "Automatic updates are unavailable for this build."
      : getDesktopUpdateButtonTooltip(desktopUpdateState, {
          installing: installingDesktopUpdate,
        });

  const desktopUpdateButtonDisabled =
    !desktopUpdateState?.enabled ||
    isDesktopUpdateButtonDisabled(desktopUpdateState) ||
    installingDesktopUpdate;

  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";

  const desktopUpdateButtonPresentation = getDesktopUpdateButtonPresentation(desktopUpdateState, {
    installing: installingDesktopUpdate,
  });

  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);

  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;

  const desktopUpdateDownloadPercent = getDesktopUpdateDownloadPercent(desktopUpdateState);

  const desktopUpdateReadyVersion =
    desktopUpdateState?.downloadedVersion ?? desktopUpdateState?.availableVersion ?? null;

  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "check") {
      void bridge
        .checkForUpdates()
        .then((nextState) => {
          setInstallingDesktopUpdate(false);
          setDesktopUpdateState(nextState);
          if (nextState.status === "available") {
            toastManager.add({
              type: "info",
              title: "Preparing update",
              description: `Glade is preparing version ${nextState.availableVersion ?? "available"} in the background.`,
            });
            return;
          }

          if (nextState.status === "downloading") {
            toastManager.add({
              type: "info",
              title: "Preparing update",
              description: "Glade is downloading the update in the background.",
            });
            return;
          }

          if (nextState.status === "downloaded") {
            toastManager.add({
              type: "success",
              title: "Update ready",
              description: "Click Update when you’re ready to restart and install it.",
            });
            return;
          }

          if (nextState.status === "up-to-date") {
            toastManager.add({
              type: "info",
              title: "You're up to date",
              description: `Glade ${nextState.currentVersion} is already the newest version.`,
            });
            return;
          }

          if (nextState.status === "error") {
            surfaceDesktopUpdateError({
              title: "Could not check for updates",
              description: nextState.message ?? "An unexpected error occurred.",
              state: nextState,
            });
          }
        })
        .catch((error) => {
          surfaceDesktopUpdateError({
            title: "Could not check for updates",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
            state: desktopUpdateState,
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          setInstallingDesktopUpdate(false);
          setDesktopUpdateState(result.state);
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update ready",
              description: "Click Update when you’re ready to restart and install it.",
            });
          }
          const alreadyCurrentNotice = getDesktopUpdateAlreadyCurrentNotice(result);
          if (alreadyCurrentNotice) {
            toastManager.add({
              type: "info",
              title: "Already up to date",
              description: alreadyCurrentNotice,
            });
            return;
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          surfaceDesktopUpdateError({
            title: "Could not download update",
            description: actionError,
            state: result.state,
          });
        })
        .catch((error) => {
          surfaceDesktopUpdateError({
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
            state: desktopUpdateState,
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      setInstallingDesktopUpdate(true);
      const install = async () => {
        const state = useStore.getState();
        if (!state.threadsHydrated) {
          throw new Error("Chats are still loading. Try updating again in a moment.");
        }
        const chats = listRunningChatsFromDesktopStore(state);
        if (chats.length > 0) await stopLocalRunningChats(chats, true);
        persistAppStateNow();
        return bridge.installUpdate();
      };
      void install()
        .then((result) => {
          setDesktopUpdateState(result.state);
          if (!isDesktopUpdateInstallInFlight(result)) {
            setInstallingDesktopUpdate(false);
          }
          const alreadyCurrentNotice = getDesktopUpdateAlreadyCurrentNotice(result);
          if (alreadyCurrentNotice) {
            toastManager.add({
              type: "info",
              title: "Already up to date",
              description: alreadyCurrentNotice,
            });
            return;
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          surfaceDesktopUpdateError({
            title: "Could not install update",
            description: actionError,
            state: result.state,
          });
        })
        .catch((error) => {
          setInstallingDesktopUpdate(false);
          surfaceDesktopUpdateError({
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
            state: desktopUpdateState,
          });
        });
    }
  }, [
    desktopUpdateButtonAction,
    desktopUpdateButtonDisabled,
    desktopUpdateState,
    surfaceDesktopUpdateError,
    setDesktopUpdateState,
    setInstallingDesktopUpdate,
  ]);

  return {
    installing: installingDesktopUpdate,
    showDesktopUpdateButton,
    desktopUpdateTooltip,
    desktopUpdateButtonDisabled,
    desktopUpdateButtonAction,
    desktopUpdateButtonPresentation,
    showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription,
    desktopUpdateDownloadPercent,
    desktopUpdateReadyVersion,
    desktopCurrentVersion: desktopUpdateState?.currentVersion ?? null,
    handleDesktopUpdateButtonClick,
  };
}
