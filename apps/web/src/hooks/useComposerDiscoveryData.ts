import type { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProjectEntry } from "@glade/contracts/workspace/project";
import type {
  ProviderMentionReference,
  ProviderNativeCommandDescriptor,
  ProviderPluginDescriptor,
  ProviderSkillDescriptor,
} from "@glade/contracts/provider/providerDiscovery";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQuery } from "@tanstack/react-query";

import type { ComposerTrigger } from "~/composer-logic";
import { isLocalFolderMentionQuery } from "~/lib/localFolderMentions";
import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import {
  providerCommandsQueryOptions,
  providerComposerCapabilitiesQueryOptions,
  providerPluginsQueryOptions,
  providerSkillsQueryOptions,
  supportsNativeSlashCommandDiscovery,
  supportsPluginDiscovery,
  supportsSkillDiscovery,
  supportsThreadCompaction,
} from "~/lib/providerDiscoveryReactQuery";

type ComposerPluginSuggestion = {
  plugin: ProviderPluginDescriptor;
  mention: ProviderMentionReference;
};

const EMPTY_PROJECT_ENTRIES: ProjectEntry[] = [];
const EMPTY_PROVIDER_NATIVE_COMMANDS: ProviderNativeCommandDescriptor[] = [];
const EMPTY_PROVIDER_SKILLS: ProviderSkillDescriptor[] = [];
const EMPTY_COMPOSER_PLUGIN_SUGGESTIONS: ComposerPluginSuggestion[] = [];

export function useComposerDiscoveryData(input: {
  threadId: ThreadId;
  provider: ProviderKind;
  trigger: ComposerTrigger | null;
  providerCwd: string | null;
  workspaceCwd: string | null;
  browseLocalFolders: boolean;
  discoverNativeCompaction?: boolean;
}) {
  const triggerKind = input.trigger?.kind ?? null;
  const mentionTriggerQuery = input.trigger?.kind === "mention" ? input.trigger.query : "";
  const isMentionTrigger = triggerKind === "mention";
  const isLocalFolderBrowserOpen =
    input.browseLocalFolders && isMentionTrigger && isLocalFolderMentionQuery(mentionTriggerQuery);
  const [debouncedPathQuery, pathQueryDebouncer] = useDebouncedValue(
    mentionTriggerQuery,
    { wait: 120 },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const capabilitiesQuery = useQuery(providerComposerCapabilitiesQueryOptions(input.provider));
  const commandsQuery = useQuery(
    providerCommandsQueryOptions({
      provider: input.provider,
      cwd: input.providerCwd,
      threadId: input.threadId,
      enabled:
        (triggerKind === "slash-command" ||
          triggerKind === "slash-model" ||
          input.discoverNativeCompaction === true) &&
        supportsNativeSlashCommandDiscovery(capabilitiesQuery.data) &&
        input.providerCwd !== null,
    }),
  );
  const skillsQuery = useQuery(
    providerSkillsQueryOptions({
      provider: input.provider,
      cwd: input.providerCwd,
      threadId: input.threadId,
      enabled:
        (triggerKind === "skill" || triggerKind === "slash-command") &&
        supportsSkillDiscovery(capabilitiesQuery.data) &&
        input.providerCwd !== null,
    }),
  );
  const pluginsQuery = useQuery(
    providerPluginsQueryOptions({
      provider: input.provider,
      cwd: input.providerCwd,
      threadId: input.threadId,
      enabled: supportsPluginDiscovery(capabilitiesQuery.data) && input.providerCwd !== null,
    }),
  );
  const entriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: input.workspaceCwd,
      query: mentionTriggerQuery.length > 0 ? debouncedPathQuery : "",
      enabled: isMentionTrigger && !isLocalFolderBrowserOpen,
      limit: 80,
    }),
  );

  const providerPlugins =
    pluginsQuery.data?.marketplaces.flatMap((marketplace) =>
      marketplace.plugins.map((plugin) => ({
        plugin,
        mention: {
          name: plugin.name,
          path: `plugin://${plugin.name}@${marketplace.name}`,
        } satisfies ProviderMentionReference,
      })),
    ) ?? EMPTY_COMPOSER_PLUGIN_SUGGESTIONS;
  const providerNativeCommands = commandsQuery.data?.commands ?? EMPTY_PROVIDER_NATIVE_COMMANDS;
  const isComposerMenuLoading =
    (triggerKind === "mention" &&
      ((mentionTriggerQuery.length > 0 && pathQueryDebouncer.state.isPending) ||
        entriesQuery.isLoading ||
        entriesQuery.isFetching ||
        pluginsQuery.isLoading ||
        pluginsQuery.isFetching)) ||
    (triggerKind === "slash-command" &&
      (commandsQuery.isLoading ||
        commandsQuery.isFetching ||
        skillsQuery.isLoading ||
        skillsQuery.isFetching)) ||
    (triggerKind === "skill" &&
      (capabilitiesQuery.isLoading ||
        capabilitiesQuery.isFetching ||
        skillsQuery.isLoading ||
        skillsQuery.isFetching));

  return {
    triggerKind,
    mentionTriggerQuery,
    isLocalFolderBrowserOpen,
    providerPlugins,
    providerNativeCommands,
    providerArtifacts: commandsQuery.data?.artifacts,
    providerSkills: skillsQuery.data?.skills ?? EMPTY_PROVIDER_SKILLS,
    workspaceEntries: entriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES,
    isComposerMenuLoading,
    canCompactThread: supportsThreadCompaction(capabilitiesQuery.data),
    isNativeCommandDiscoveryPending:
      capabilitiesQuery.isPending ||
      (supportsNativeSlashCommandDiscovery(capabilitiesQuery.data) && commandsQuery.isPending) ||
      commandsQuery.isFetching,
  };
}
