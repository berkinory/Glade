import type { ServerSettings } from "@glade/contracts/settings/settings";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { environmentServerSettingsQueryOptions } from "~/lib/serverReactQuery";
import type { SettingsMachine } from "../machine/settingsMachine";
import { skillNameKey } from "./skills.logic";

// Skills are turned off by name in a machine's server settings, for every agent on it at once.
export function useSkillToggles(machine: SettingsMachine) {
  const queryClient = useQueryClient();
  const settingsOptions = environmentServerSettingsQueryOptions(machine.key);
  const settingsQuery = useQuery({ ...settingsOptions, enabled: machine.api !== null });
  const disabled = new Set((settingsQuery.data?.skills.disabled ?? []).map(skillNameKey));

  const setEnabled = (skillName: string, enabled: boolean) => {
    if (!machine.api) return;
    const latest = queryClient.getQueryData<ServerSettings>(settingsOptions.queryKey);
    const next = new Set((latest?.skills.disabled ?? [...disabled]).map(skillNameKey));
    if (enabled) next.delete(skillNameKey(skillName));
    else next.add(skillNameKey(skillName));
    const skills = { disabled: [...next].toSorted() };
    if (latest) queryClient.setQueryData(settingsOptions.queryKey, { ...latest, skills });
    void machine.api.server
      .updateSettings({ skills })
      .then((settings) => {
        queryClient.setQueryData(settingsOptions.queryKey, settings);
        void queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
      })
      .catch(() => queryClient.invalidateQueries({ queryKey: settingsOptions.queryKey }));
  };

  return { isEnabled: (key: string) => !disabled.has(key), setEnabled };
}
