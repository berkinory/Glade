import type { ProviderAgentDescriptor } from "@glade/contracts/provider/providerDiscovery";
import type { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";

import type { ComposerCommandItem } from "~/components/chat/ComposerCommandMenu";
import type { ComposerTrigger } from "~/composer-logic";
import {
  buildSearchableModelOptions,
  useComposerCommandMenuItems,
} from "~/hooks/useComposerCommandMenuItems";
import { useComposerDiscoveryData } from "~/hooks/useComposerDiscoveryData";
import { getLocalFolderBrowseRootPath } from "~/lib/localFolderMentions";
import { resolveProviderDiscoveryCwd } from "~/lib/providerDiscovery";
import { isMacNavigatorPlatform } from "~/lib/utils";
import type { ProviderModelOption } from "../../providerModelOptions";
import { AVAILABLE_PROVIDER_OPTIONS } from "../chat/ProviderModelPicker";

const KANBAN_SUPPORTED_APP_SLASH_COMMANDS = new Set(["clear", "default", "plan"]);

interface UseKanbanTaskComposerDiscoveryInput {
  readonly composerTrigger: ComposerTrigger | null;
  readonly selectedProvider: ProviderKind;
  readonly modelOptionsByProvider: Record<
    ProviderKind,
    ReadonlyArray<ProviderModelOption & { isSelectedHint?: boolean }>
  >;
  readonly selectedRuntimeAgents: readonly ProviderAgentDescriptor[];
  readonly selectedProjectCwd: string | null;
  readonly serverCwd: string | null;
  readonly serverHomeDir: string | null;
  readonly scratchThreadId: ThreadId;
  readonly hiddenProviders: readonly ProviderKind[];
  readonly providerOrder: readonly ProviderKind[];
}

export function useKanbanTaskComposerDiscovery(input: UseKanbanTaskComposerDiscoveryInput): {
  readonly mentionTriggerQuery: string;
  readonly isLocalFolderBrowserOpen: boolean;
  readonly localFolderBrowseRootPath: string | null;
  readonly composerMenuItems: ComposerCommandItem[];
  readonly isComposerMenuLoading: boolean;
} {
  const discovery = useComposerDiscoveryData({
    threadId: input.scratchThreadId,
    provider: input.selectedProvider,
    trigger: input.composerTrigger,
    providerCwd: resolveProviderDiscoveryCwd({
      activeThreadWorktreePath: null,
      activeProjectCwd: input.selectedProjectCwd,
      serverCwd: input.serverCwd,
    }),
    workspaceCwd: input.selectedProjectCwd,
    browseLocalFolders: true,
  });
  const searchableModelOptions = buildSearchableModelOptions({
    providerOptions: AVAILABLE_PROVIDER_OPTIONS,
    modelOptionsByProvider: input.modelOptionsByProvider,
    providerOrder: input.providerOrder,
    hiddenProviders: input.hiddenProviders,
    protectedProviders: [input.selectedProvider],
  });
  const dynamicAgents = input.selectedRuntimeAgents.map((agent) =>
    agent.description
      ? { name: agent.name, displayName: agent.displayName, description: agent.description }
      : { name: agent.name, displayName: agent.displayName },
  );
  const rawComposerMenuItems = useComposerCommandMenuItems({
    trigger: { composerTrigger: input.composerTrigger },
    catalog: {
      provider: input.selectedProvider,
      providerPlugins: discovery.providerPlugins,
      providerNativeCommands: discovery.providerNativeCommands,
      providerSkills: discovery.providerSkills,
      searchableModelOptions,
      providerArtifacts: discovery.providerArtifacts,
      dynamicAgents,
    },
    references: { workspaceEntries: discovery.workspaceEntries },
    commands: {
      supportsFastSlashCommand: false,
      canOfferCompactCommand: false,
      canOfferReviewCommand: false,
      canOfferForkCommand: false,
      canOfferExportCommand: false,
      surfaceAppSlashCommands: KANBAN_SUPPORTED_APP_SLASH_COMMANDS,
    },
  });
  const composerMenuItems = rawComposerMenuItems.filter(
    (item) =>
      item.type !== "slash-command" || KANBAN_SUPPORTED_APP_SLASH_COMMANDS.has(item.command),
  );

  return {
    mentionTriggerQuery: discovery.mentionTriggerQuery,
    isLocalFolderBrowserOpen: discovery.isLocalFolderBrowserOpen,
    localFolderBrowseRootPath: getLocalFolderBrowseRootPath(
      input.serverHomeDir,
      isMacNavigatorPlatform(),
    ),
    composerMenuItems,
    isComposerMenuLoading: discovery.isComposerMenuLoading,
  };
}
