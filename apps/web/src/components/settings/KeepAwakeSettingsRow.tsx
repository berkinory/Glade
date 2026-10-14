import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_KEEP_AWAKE_MODE,
  type KeepAwakeMode,
  type ServerSettingsPatch,
  type ServerSettings,
} from "@glade/contracts/settings/settings";
import { Switch } from "~/components/ui/switch";
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

  function update(patch: ServerSettingsPatch): void {
    const latest = queryClient.getQueryData<ServerSettings>(serverQueryKeys.settings());
    if (latest) queryClient.setQueryData(serverQueryKeys.settings(), { ...latest, ...patch });
    void ensureNativeApi()
      .server.updateSettings(patch)
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
    <>
      <SettingsRow
        id="setting-keep-awake"
        title="Keep Mac awake"
        description={
          unsupported
            ? "Available when the Glade server runs on macOS."
            : "Prevent idle sleep while agents work, or always."
        }
        status={unsupported ? undefined : statusText}
        resetAction={
          !unsupported && mode !== undefined && mode !== DEFAULT_KEEP_AWAKE_MODE ? (
            <SettingResetButton
              label="keep Mac awake"
              onClick={() => update({ keepAwakeMode: DEFAULT_KEEP_AWAKE_MODE })}
            />
          ) : null
        }
        control={
          status?.supported && mode !== undefined ? (
            <SettingsSegmentedControl
              value={mode}
              onValueChange={(keepAwakeMode) => update({ keepAwakeMode })}
              ariaLabel="Keep Mac awake"
              options={KEEP_AWAKE_OPTIONS}
            />
          ) : null
        }
      />
      {!unsupported && settingsQuery.data && (
        <SettingsRow
          id="setting-keep-display-awake"
          title="Keep display awake"
          description="Also prevent the display from dimming or turning off while Keep Mac awake is active."
          resetAction={
            settingsQuery.data.keepDisplayAwake ? (
              <SettingResetButton
                label="keep display awake"
                onClick={() => update({ keepDisplayAwake: false })}
              />
            ) : null
          }
          control={
            <Switch
              checked={settingsQuery.data.keepDisplayAwake}
              disabled={!status?.supported || mode === "off"}
              onCheckedChange={(checked) => update({ keepDisplayAwake: Boolean(checked) })}
              aria-label="Keep display awake"
            />
          }
        />
      )}
    </>
  );
}
