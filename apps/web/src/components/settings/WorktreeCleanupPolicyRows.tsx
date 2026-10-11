import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServerSettings, ServerSettingsPatch } from "@glade/contracts/settings/settings";
import { Switch } from "~/components/ui/switch";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { SettingsSegmentedControl } from "./SettingControls";
import { SettingsRow } from "./SettingsPanelPrimitives";

const MAX_AGE_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;

type MaxAgeOption = (typeof MAX_AGE_OPTIONS)[number]["value"];

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
  const maxAge: MaxAgeOption =
    settings.archivedWorktreeMaxAgeDays === null
      ? "never"
      : (MAX_AGE_OPTIONS.find(
          (option) => option.value === String(settings.archivedWorktreeMaxAgeDays),
        )?.value ?? "never");
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
      <SettingsRow
        id="setting-archived-worktree-max-age"
        title="Delete archived worktrees after"
        description="Glade always keeps the 15 most recent archived chats' worktrees unless a rule above removes them. Worktrees with uncommitted changes are never removed, and a snapshot is kept for 30 days."
        control={
          <SettingsSegmentedControl
            value={maxAge}
            onValueChange={(value) =>
              update({ archivedWorktreeMaxAgeDays: value === "never" ? null : Number(value) })
            }
            ariaLabel="Delete archived worktrees after"
            options={MAX_AGE_OPTIONS}
          />
        }
      />
    </>
  );
}
