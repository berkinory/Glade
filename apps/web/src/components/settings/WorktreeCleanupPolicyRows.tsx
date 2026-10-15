import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServerSettings, ServerSettingsPatch } from "@glade/contracts/settings/settings";
import { Switch } from "~/components/ui/switch";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { SettingsRow } from "./SettingsPanelPrimitives";

export function WorktreeCleanupPolicyRows() {
  const queryClient = useQueryClient();
  const settings = useQuery(serverSettingsQueryOptions()).data;

  const update = (patch: ServerSettingsPatch & Partial<ServerSettings>) => {
    const latest = queryClient.getQueryData<ServerSettings>(serverQueryKeys.settings());
    if (latest) queryClient.setQueryData(serverQueryKeys.settings(), { ...latest, ...patch });
    void ensureNativeApi()
      .server.updateSettings(patch)
      .then((next) => queryClient.setQueryData(serverQueryKeys.settings(), next))
      .catch(() => queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() }));
  };

  if (!settings) return null;
  return (
    <>
      <SettingsRow
        id="setting-delete-merged-worktrees"
        title="Delete worktrees of merged pull requests"
        description="For archived chats whose pull request was merged, remove the clean worktree. Branches with commits found nowhere else are kept."
        control={
          <Switch
            checked={settings.deleteMergedArchivedWorktrees}
            onCheckedChange={(checked) =>
              update({ deleteMergedArchivedWorktrees: Boolean(checked) })
            }
            aria-label="Delete worktrees of merged pull requests"
          />
        }
      />
    </>
  );
}
