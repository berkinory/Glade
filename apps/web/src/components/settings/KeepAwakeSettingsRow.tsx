import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_KEEP_AWAKE_MODE,
  type KeepAwakeMode,
  type ServerSettings,
} from "@glade/contracts/settings/settings";
import { ensureNativeApi } from "~/nativeApi";
import {
  serverKeepAwakeStatusQueryOptions,
  serverQueryKeys,
  serverSettingsQueryOptions,
} from "~/lib/serverReactQuery";
import { SettingResetButton, SettingsSegmentedControl } from "./SettingControls";
import { SettingsRow } from "./SettingsPanelPrimitives";

const KEEP_AWAKE_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "agent", label: "While working" },
  { value: "always", label: "Always" },
] as const satisfies ReadonlyArray<{ value: KeepAwakeMode; label: string }>;

export function KeepAwakeSettingsRow() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(serverSettingsQueryOptions());
  const statusQuery = useQuery(serverKeepAwakeStatusQueryOptions());
  const mode = settingsQuery.data?.keepAwakeMode;
  const status = statusQuery.data;

  function setMode(keepAwakeMode: KeepAwakeMode): void {
    const latest = queryClient.getQueryData<ServerSettings>(serverQueryKeys.settings());
    if (latest) queryClient.setQueryData(serverQueryKeys.settings(), { ...latest, keepAwakeMode });
    void ensureNativeApi()
      .server.updateSettings({ keepAwakeMode })
      .then((next) => queryClient.setQueryData(serverQueryKeys.settings(), next))
      .catch(() => queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() }))
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.keepAwakeStatus() });
      });
  }

  const unsupported = status?.supported === false;
  const statusText = statusQuery.isError
    ? "Could not read the keep-awake state."
    : (status?.error ??
      (status?.active
        ? "Keeping this Mac awake now."
        : mode === "agent" && status?.supported
          ? "Idle until an agent starts working."
          : undefined));

  return (
    <SettingsRow
      id="setting-keep-awake"
      title="Keep Mac awake"
      description={
        unsupported
          ? "Available when the Glade server runs on macOS."
          : "Prevent idle sleep while agents work, or always. The display can still turn off."
      }
      status={unsupported ? undefined : statusText}
      resetAction={
        !unsupported && mode !== undefined && mode !== DEFAULT_KEEP_AWAKE_MODE ? (
          <SettingResetButton
            label="keep Mac awake"
            onClick={() => setMode(DEFAULT_KEEP_AWAKE_MODE)}
          />
        ) : null
      }
      control={
        status?.supported && mode !== undefined ? (
          <SettingsSegmentedControl
            value={mode}
            onValueChange={setMode}
            ariaLabel="Keep Mac awake"
            options={KEEP_AWAKE_OPTIONS}
          />
        ) : null
      }
    />
  );
}
