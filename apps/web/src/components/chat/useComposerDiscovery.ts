import { type ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";

import type { ComposerTrigger } from "~/composer-logic";
import {
  hasProviderNativeSlashCommand,
  providerSupportsTextNativeReviewCommand,
} from "~/composerSlashCommands";
import { useComposerDiscoveryData } from "~/hooks/useComposerDiscoveryData";

interface ComposerDiscoveryInput {
  threadId: ThreadId;
  selectedProvider: ProviderKind;
  composerTrigger: ComposerTrigger | null;
  composerCommandPicker: "fork-target" | "review-target" | null;
  providerModelDiscoveryCwd: string | null;
  gitCwd: string | null;
  discoverNativeCompaction?: boolean;
}

export function useComposerDiscovery({
  threadId,
  selectedProvider,
  composerTrigger,
  composerCommandPicker,
  providerModelDiscoveryCwd,
  gitCwd,
  discoverNativeCompaction,
}: ComposerDiscoveryInput) {
  const discovery = useComposerDiscoveryData({
    threadId,
    provider: selectedProvider,
    trigger: composerTrigger,
    providerCwd: providerModelDiscoveryCwd,
    workspaceCwd: gitCwd,
    browseLocalFolders: composerCommandPicker === null,
    ...(discoverNativeCompaction !== undefined ? { discoverNativeCompaction } : {}),
  });
  const providerNativeCommandNames = discovery.providerNativeCommands.map(
    (command) => command.name,
  );
  const effectiveComposerTrigger =
    composerTrigger?.kind === "slash-model" &&
    hasProviderNativeSlashCommand(selectedProvider, providerNativeCommandNames, "model")
      ? { ...composerTrigger, kind: "slash-command" as const, query: "model" }
      : composerTrigger;
  const supportsTextNativeReviewCommand = providerSupportsTextNativeReviewCommand(
    selectedProvider,
    discovery.providerNativeCommands,
  );

  return {
    mentionTriggerQuery: discovery.mentionTriggerQuery,
    isLocalFolderBrowserOpen: discovery.isLocalFolderBrowserOpen,
    providerPlugins: discovery.providerPlugins,
    providerNativeCommands: discovery.providerNativeCommands,
    providerArtifacts: discovery.providerArtifacts,
    providerSkills: discovery.providerSkills,
    workspaceEntries: discovery.workspaceEntries,
    effectiveComposerTrigger,
    effectiveComposerTriggerKind: effectiveComposerTrigger?.kind ?? null,
    supportsTextNativeReviewCommand,
    isComposerMenuLoading: discovery.isComposerMenuLoading,
    canCompactThread: discovery.canCompactThread,
    isNativeCommandDiscoveryPending: discovery.isNativeCommandDiscoveryPending,
  };
}
