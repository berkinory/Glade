import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_KEEP_AWAKE_MODE,
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
import { SettingResetButton } from "./SettingControls";
import { SettingsRow } from "./SettingsPanelPrimitives";

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

  return (
    <>
      <SettingsRow
        id="setting-keep-awake"
        title="Keep Mac awake"
        description={
          unsupported
            ? "Available when the Glade server runs on macOS."
            : "Prevent idle sleep while agents work."
        }
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
            <Switch
              checked={mode === "agent"}
              onCheckedChange={(checked) => update({ keepAwakeMode: checked ? "agent" : "off" })}
              aria-label="Keep Mac awake while agents work"
            />
          ) : null
        }
      />
      {!unsupported && settingsQuery.data && (
        <SettingsRow
          id="setting-keep-display-awake"
          title="Keep display awake"
          description="Also prevent the display from dimming or turning off while Keep Mac awake is active."
          disabled={!status?.supported || mode === "off"}
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
