import type { ServerSettings } from "@glade/contracts/settings/settings";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { skillNameKey } from "./skills.logic";

// Skills are turned off by name in the server settings, for every agent at once.
export function useSkillToggles() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(serverSettingsQueryOptions());
  const disabled = new Set((settingsQuery.data?.skills.disabled ?? []).map(skillNameKey));

  const setEnabled = (skillName: string, enabled: boolean) => {
    const latest = queryClient.getQueryData<ServerSettings>(serverQueryKeys.settings());
    const next = new Set((latest?.skills.disabled ?? [...disabled]).map(skillNameKey));
    if (enabled) next.delete(skillNameKey(skillName));
    else next.add(skillNameKey(skillName));
    const skills = { disabled: [...next].toSorted() };
    if (latest) queryClient.setQueryData(serverQueryKeys.settings(), { ...latest, skills });
    void ensureNativeApi()
      .server.updateSettings({ skills })
      .then((settings) => {
        queryClient.setQueryData(serverQueryKeys.settings(), settings);
        void queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
      })
      .catch(() => queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() }));
  };

  return { isEnabled: (key: string) => !disabled.has(key), setEnabled };
}
