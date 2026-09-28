import type { DesktopUpdateState } from "@glade/contracts";
import { useEffect, useState } from "react";

import {
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDownloadPercent,
  isDesktopUpdateButtonDisabled,
  isDesktopUpdateInstallInFlight,
  resolveDesktopUpdateButtonAction,
} from "~/components/desktopUpdate.logic";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { persistAppStateNow } from "~/store";
import { SettingsRow } from "./SettingsPanelPrimitives";

export function DesktopUpdateSettingsRow() {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const bridge = window.desktopBridge;

  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    let receivedUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedUpdate = true;
      setState(nextState);
      if (nextState.status !== "downloaded" || nextState.errorContext === "install") {
        setInstalling(false);
      }
    });
    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (!disposed && !receivedUpdate) setState(nextState);
      })
      .catch(() => {
        if (!disposed) toastManager.add({ type: "error", title: "Could not read update status" });
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [bridge]);

  if (!bridge) return null;

  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";
  const disabled = busy || installing || !state?.enabled || isDesktopUpdateButtonDisabled(state);
  const progress = getDesktopUpdateDownloadPercent(state);
  const description = !state
    ? "Loading update status…"
    : !state.enabled
      ? "Automatic updates are unavailable for this build."
      : getDesktopUpdateButtonTooltip(state);
  const label = installing
    ? "Updating…"
    : state?.status === "checking"
      ? "Checking…"
      : state?.status === "downloading"
        ? progress === null
          ? "Preparing…"
          : `Preparing ${progress}%`
        : action === "install"
          ? "Restart and update"
          : action === "download"
            ? state?.errorContext
              ? "Retry download"
              : "Prepare update"
            : "Check for updates";

  const handleAction = async () => {
    if (!state || disabled || action === "none") return;
    setBusy(true);
    try {
      if (action === "check") {
        const nextState = await bridge.checkForUpdates();
        setState(nextState);
        if (nextState.status === "up-to-date") {
          toastManager.add({
            type: "info",
            title: "You're up to date",
            description: `Glade ${nextState.currentVersion} is the newest version.`,
          });
        } else if (nextState.status === "error") {
          toastManager.add({
            type: "error",
            title: "Could not check for updates",
            description: nextState.message ?? "Please try again.",
          });
        }
      } else if (action === "download") {
        const result = await bridge.downloadUpdate();
        setState(result.state);
        const error = getDesktopUpdateActionError(result);
        if (error)
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: error,
          });
      } else {
        persistAppStateNow();
        setInstalling(true);
        const result = await bridge.installUpdate();
        setState(result.state);
        if (!isDesktopUpdateInstallInFlight(result)) setInstalling(false);
        const error = getDesktopUpdateActionError(result);
        if (error)
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error,
          });
      }
    } catch (error) {
      setInstalling(false);
      toastManager.add({
        type: "error",
        title: "Update action failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsRow
      title="Updates"
      description={description}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || action === "none"}
          onClick={() => void handleAction()}
        >
          {label}
        </Button>
      }
    />
  );
}
