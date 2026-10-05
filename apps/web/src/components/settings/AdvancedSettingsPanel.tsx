import { UndoIcon } from "~/lib/icons";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { logoutCurrentBrowserSession } from "~/authLogout";
import { useOnboardingDialogStore } from "~/onboarding/onboardingDialogStore";
import { APP_VERSION } from "~/branding";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { ensureNativeApi, readNativeApi } from "~/nativeApi";
import { serverAuthSessionQueryOptions } from "~/lib/serverReactQuery";
import { useStore } from "~/store";
import { createAllThreadsMessagelessSelector, createThreadShellsSelector } from "~/storeSelectors";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";
import { DesktopUpdateSettingsRow } from "./DesktopUpdateSettingsRow";
export function AdvancedSettingsPanel(props: {
  active: boolean;
  onOpenReleaseHistory: () => void;
  onRestoreDefaults: () => void;
}) {
  const authSessionQuery = useQuery(serverAuthSessionQueryOptions());
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const threadShells = useStore(useMemo(() => createThreadShellsSelector(), []));
  const allThreadsMessageless = useStore(useMemo(() => createAllThreadsMessagelessSelector(), []));
  const projectCount = useStore((store) => store.projects.length);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const [isRepairingLocalState, setIsRepairingLocalState] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const shouldOfferRecoveryTools = useMemo(() => {
    if (!threadsHydrated || projectCount === 0) return false;
    return threadShells.length === 0 || allThreadsMessageless;
  }, [allThreadsMessageless, projectCount, threadShells.length, threadsHydrated]);
  const repairLocalState = useCallback(async () => {
    if (isRepairingLocalState) return;
    const api = readNativeApi() ?? ensureNativeApi();
    const confirmed = await api.dialogs.confirm(
      [
        "Repair local state?",
        "This rebuilds local project indexes and refreshes project snapshots.",
        "It keeps existing chats in place, but it may take a moment.",
      ].join("\n"),
    );
    if (!confirmed) return;
    setIsRepairingLocalState(true);
    await api.orchestration
      .repairState()
      .then((snapshot) => {
        syncServerReadModel(snapshot);
        toastManager.add({
          type: "success",
          title: "Local state repaired",
          description: "Project indexes were rebuilt without clearing existing chats.",
        });
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Repair failed",
          description: error instanceof Error ? error.message : "Unable to repair local state.",
        });
      })
      .finally(() => {
        setIsRepairingLocalState(false);
      });
  }, [isRepairingLocalState, syncServerReadModel]);
  const logoutCurrentSession = useCallback(async () => {
    if (isLoggingOut) return;
    const api = readNativeApi() ?? ensureNativeApi();
    setIsLoggingOut(true);
    const result = await logoutCurrentBrowserSession({
      confirm: () =>
        api.dialogs.confirm(
          "Sign out this browser?\n\nIts session and every live connection opened with it will be revoked.",
        ),
      logout: () => api.server.logoutAuthSession(),
      navigate: (path) => window.location.assign(path),
      onError: (error) =>
        toastManager.add({
          type: "error",
          title: "Sign out failed",
          description: error instanceof Error ? error.message : "Unable to revoke this session.",
        }),
    });
    if (result !== "redirecting") setIsLoggingOut(false);
  }, [isLoggingOut]);
  if (!props.active) return null;
  return (
    <div className="space-y-6">
      {authSessionQuery.data?.authenticated ? (
        <SettingsSection title="Session">
          <SettingsRow
            title="This browser"
            description="Revoke this browser session and close every live Glade connection it owns. A fresh pairing link is required to reconnect."
            status={`Authenticated as ${authSessionQuery.data.role ?? "client"}.`}
            control={
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={isLoggingOut}
                onClick={() => void logoutCurrentSession()}
              >
                {isLoggingOut ? "Signing out..." : "Sign out"}
              </Button>
            }
          />
        </SettingsSection>
      ) : null}
      <SettingsSection title="Recovery">
        <SettingsRow
          id="setting-recovery-tools"
          title="Recovery tools"
          description="Rebuild local project indexes without clearing existing chats when the local state gets out of sync."
          status={
            shouldOfferRecoveryTools
              ? "Visible because projects exist but no chat history is currently available."
              : "Available when projects exist but chat history is missing."
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!shouldOfferRecoveryTools || isRepairingLocalState}
              onClick={() => void repairLocalState()}
            >
              {isRepairingLocalState ? "Repairing..." : "Repair state"}
            </Button>
          }
        />
      </SettingsSection>
      <SettingsSection title="About">
        <DesktopUpdateSettingsRow />
        <SettingsRow
          id="setting-version"
          title="Version"
          control={
            <code className="text-ui leading-snug font-medium text-muted-foreground">
              {APP_VERSION}
            </code>
          }
        />
        <SettingsRow
          id="setting-release-history"
          title="Release history"
          control={
            <Button size="sm" variant="outline" onClick={props.onOpenReleaseHistory}>
              View release history
            </Button>
          }
        />
      </SettingsSection>
      <SettingsSection title="Getting started">
        <SettingsRow
          id="setting-welcome-tour"
          title="Welcome tour"
          description="Replay the first-run setup: feature tour, provider selection, appearance, and first project."
          control={
            <Button
              variant="outline"
              onClick={() => useOnboardingDialogStore.getState().openDialog()}
            >
              Open welcome tour
            </Button>
          }
        />
      </SettingsSection>
      <SettingsSection title="Reset settings">
        <SettingsRow
          id="setting-restore-defaults"
          title="Restore defaults"
          description="Reset Glade preferences, theme customizations, and provider preferences."
          control={
            <Button size="sm" variant="outline" onClick={() => props.onRestoreDefaults()}>
              <UndoIcon className="size-3.5" />
              Restore defaults
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}
