import { UndoIcon } from "~/lib/icons";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { logoutCurrentBrowserSession } from "~/authLogout";
import { useOnboardingDialogStore } from "~/onboarding/onboardingDialogStore";
import { APP_VERSION } from "~/branding";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { ensureNativeApi, readNativeApi } from "~/nativeApi";
import { serverAuthSessionQueryOptions } from "~/lib/serverReactQuery";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";
import { DesktopUpdateSettingsRow } from "./DesktopUpdateSettingsRow";
export function AdvancedSettingsPanel(props: {
  active: boolean;
  onOpenReleaseHistory: () => void;
  onRestoreDefaults: () => void;
}) {
  const authSessionQuery = useQuery(serverAuthSessionQueryOptions());
  const [isLoggingOut, setIsLoggingOut] = useState(false);
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
              <UndoIcon />
              Restore defaults
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}
