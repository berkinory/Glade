import type { ProviderSkillsCatalogResult } from "@glade/contracts/provider/providerDiscovery";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";

import { useAppSettings } from "~/appSettings";
import {
  providerDiscoveryQueryKeys,
  skillsCatalogQueryOptions,
} from "~/lib/providerDiscoveryReactQuery";
import { PlusIcon } from "~/lib/icons";
import { providerNames } from "~/lib/providerNames";
import { LOCAL_ENVIRONMENT } from "~/environments/environmentKey";
import { ensureEnvironmentNativeApi } from "~/nativeApi";
import { useSettingsMachine } from "../machine/settingsMachine";
import { DEFAULT_PROVIDER_ORDER } from "~/providerOrdering";
import { Button } from "../../ui/button";
import { SearchInput } from "../../ui/search-input";
import { toastManager } from "../../ui/toast";
import { SettingsCard, SettingsEmptyState, SettingsSectionShell } from "../SettingsPanelPrimitives";
import { AddSkillDialog } from "./AddSkillDialog";
import { SkillRow } from "./SkillRow";
import { matchesSkill, type SkillGroup, skillGroups } from "./skills.logic";
import { useSkillToggles } from "./useSkillToggles";

function shareConfirmation(group: SkillGroup, catalog: ProviderSkillsCatalogResult): string {
  const agents = providerNames(group.providers);
  // Agents that read the shared folder only through Glade lose the skill everywhere else.
  const bridged = group.providers.filter((provider) => catalog.bridgedProviders.includes(provider));
  return [
    group.shared
      ? `Remove the copies of ${group.displayName} in ${agents}?\nEvery agent already loads the shared one.`
      : `Use ${group.displayName} in every agent?\nGlade moves it to ${catalog.sharedSkillsDir} and removes the copies in ${agents}.`,
    "Copies that differ from the shared one are kept.",
    ...(bridged.length > 0
      ? [`${providerNames(bridged)} outside Glade will no longer load it.`]
      : []),
  ].join("\n");
}

function copiesNote(group: SkillGroup, diverged: boolean): string | undefined {
  if (group.movableCopies === 0) return undefined;
  const agents = providerNames(group.providers);
  const one = group.providers.length === 1;
  const own = one ? "keeps its own copy" : "keep their own copies";
  return diverged
    ? `${agents} ${own}, which ${one ? "differs" : "differ"} from this one.`
    : `${agents} also ${own}.`;
}

export function SkillsSettingsPanel() {
  const machine = useSettingsMachine();
  const localApi = ensureEnvironmentNativeApi(LOCAL_ENVIRONMENT);
  const queryClient = useQueryClient();
  const catalogQuery = useQuery(skillsCatalogQueryOptions(machine.key, machine.api !== null));
  const { settings } = useAppSettings();
  const toggles = useSkillToggles(machine);
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search).trim().toLowerCase();
  const [sharing, setSharing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Skills whose remaining agent copies differ from the shared one, so removing them does nothing.
  const [diverged, setDiverged] = useState<ReadonlySet<string>>(new Set());

  const catalog = catalogQuery.data;
  const groups = catalog
    ? skillGroups(catalog, settings.disabledProviders).filter((group) => matchesSkill(group, query))
    : [];
  const shared = groups.filter((group) => group.shared);
  const nativeProviders = DEFAULT_PROVIDER_ORDER.filter(
    (provider) => !catalog?.bridgedProviders.includes(provider),
  );
  const own = groups.filter((group) => !group.shared);

  const share = async (group: SkillGroup) => {
    if (!catalog || !machine.api) return;
    if (!(await localApi.dialogs.confirm(shareConfirmation(group, catalog)))) return;
    setSharing(group.key);
    try {
      const { keptPaths } = await machine.api.provider.shareSkill({ name: group.name });
      if (keptPaths.length > 0) {
        setDiverged((current) => new Set([...current, group.key]));
        toastManager.add({
          type: "warning",
          title: "Differing copies kept",
          description: `Kept ${keptPaths.length === 1 ? "a copy that differs" : `${keptPaths.length} copies that differ`}.\n${keptPaths.join("\n")}`,
        });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not share skill",
        description: `Could not share ${group.displayName}. ${error instanceof Error ? error.message : "Try again."}`,
      });
    } finally {
      setSharing(null);
      void queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
    }
  };

  const shareButton = (group: SkillGroup, label: string) =>
    group.movableCopies > 0 && !diverged.has(group.key) ? (
      <Button
        size="sm"
        variant="outline"
        disabled={sharing !== null}
        onClick={() => void share(group)}
      >
        {sharing === group.key ? "Moving…" : label}
      </Button>
    ) : null;

  const rowProps = (group: SkillGroup) => ({
    group,
    enabled: toggles.isEnabled(group.key),
    onEnabledChange: (enabled: boolean) => toggles.setEnabled(group.name, enabled),
  });

  const status =
    machine.api === null ? (
      <SettingsEmptyState layout="status">
        {machine.label} is not connected. Glade keeps trying in the background.
      </SettingsEmptyState>
    ) : catalogQuery.isLoading ? (
      <SettingsEmptyState layout="status">Scanning skill folders…</SettingsEmptyState>
    ) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search skills"
          aria-label="Search skills"
        />
        <Button
          variant="outline"
          className="shrink-0"
          disabled={machine.api === null}
          onClick={() => setAdding(true)}
        >
          <PlusIcon aria-hidden />
          Add skill
        </Button>
      </div>
      <AddSkillDialog
        api={machine.api}
        machineLabel={machine.remote ? machine.label : null}
        open={adding}
        onOpenChange={setAdding}
        onInstalled={(name, paths) => {
          toastManager.add({
            type: "success",
            title: "Skill installed",
            description: `Installed ${name}.\n${paths.join("\n")}`,
          });
          void queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
        }}
      />

      {catalogQuery.isError ? (
        <SettingsEmptyState layout="status" tone="destructive">
          Glade could not scan the skill folders. Check that Glade is running, then reopen Settings.
        </SettingsEmptyState>
      ) : null}

      <SettingsSectionShell title="Shared with every agent">
        {status ??
          (shared.length === 0 ? (
            <SettingsEmptyState layout="status">
              {query
                ? "No shared skill matches your search."
                : "Add a skill, or choose Use in all agents on one below, and every agent gets the same copy."}
            </SettingsEmptyState>
          ) : (
            <SettingsCard>
              {shared.map((group) => (
                <SkillRow
                  key={group.key}
                  {...rowProps(group)}
                  note={copiesNote(group, diverged.has(group.key))}
                  action={shareButton(group, "Remove copies")}
                />
              ))}
            </SettingsCard>
          ))}
        {catalog ? (
          <p className="px-2 text-ui-xs text-muted-foreground">
            Skills in <code className="break-all">{catalog.sharedSkillsDir}</code> reach every
            agent: {providerNames(nativeProviders)} read the folder themselves
            {catalog.bridgedProviders.length > 0
              ? `, and Glade gives them to ${providerNames(catalog.bridgedProviders)}`
              : ""}
            .
          </p>
        ) : null}
      </SettingsSectionShell>

      <SettingsSectionShell title="In your agents">
        {status ??
          (own.length === 0 ? (
            <SettingsEmptyState layout="status">
              {query
                ? "No agent skill matches your search."
                : "Your agents have no skills of their own."}
            </SettingsEmptyState>
          ) : (
            <SettingsCard>
              {own.map((group) => (
                <SkillRow
                  key={group.key}
                  {...rowProps(group)}
                  action={shareButton(group, "Use in all agents")}
                />
              ))}
            </SettingsCard>
          ))}
        <p className="px-2 text-ui-xs text-muted-foreground">
          Each agent reads these from its own folder. Turning a skill off stops Claude and Codex
          from loading it in Glade.
        </p>
      </SettingsSectionShell>
    </div>
  );
}
