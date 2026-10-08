import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ProviderManagementContext } from "@glade/contracts/provider/providerManagement";
import { useAppSettings } from "~/appSettings";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";
import { SelectItem } from "../ui/select";
import { SettingsSelectControl } from "./SettingControls";
import {
  SettingsEmptyState,
  SettingsListRow as SettingsRow,
  SettingsSection,
} from "./SettingsPanelPrimitives";

const MANAGEMENT_PROVIDERS = [
  { provider: "codex", label: "Codex" },
  { provider: "claudeAgent", label: "Claude" },
] as const;

function useEnabledManagementProviders() {
  const { settings } = useAppSettings();
  return MANAGEMENT_PROVIDERS.filter(
    (option) => !settings.disabledProviders.includes(option.provider),
  );
}

/** The selected scope, moved to an enabled provider when its own is disabled; null when none is. */
export function useProviderManagementContext(): readonly [
  ProviderManagementContext | null,
  (context: ProviderManagementContext) => void,
] {
  const enabledProviders = useEnabledManagementProviders();
  const [context, setContext] = useState<ProviderManagementContext>({ provider: "codex" });
  const fallbackProvider = enabledProviders[0]?.provider;
  const effectiveContext = enabledProviders.some((option) => option.provider === context.provider)
    ? context
    : fallbackProvider
      ? { provider: fallbackProvider }
      : null;
  return [effectiveContext, setContext] as const;
}

export function NoManagementProviderState() {
  return (
    <SettingsEmptyState>
      No provider is enabled.{" "}
      <Link
        to="/settings"
        search={{ section: "providers" }}
        className="text-primary hover:underline"
      >
        Enable one in Providers
      </Link>{" "}
      to manage its tools.
    </SettingsEmptyState>
  );
}

export function ProviderManagementContextControls({
  context,
  onChange,
}: {
  context: ProviderManagementContext;
  onChange: (context: ProviderManagementContext) => void;
}) {
  const enabledProviders = useEnabledManagementProviders();
  const projects = useStore((state) => state.projects);
  const [threadSelector] = useState(createAllThreadsSelector);
  const threads = useStore(threadSelector).filter(
    (thread) =>
      thread.modelSelection.provider === context.provider && thread.session?.status === "running",
  );
  const value = context.threadId
    ? `thread:${context.threadId}`
    : context.cwd
      ? `project:${context.cwd}`
      : "provider";
  return (
    <SettingsSection title="Scope">
      <SettingsRow
        title="Provider"
        actions={
          <SettingsSelectControl
            value={context.provider}
            valueContent={context.provider === "codex" ? "Codex" : "Claude"}
            ariaLabel="Provider"
            onValueChange={(provider) => {
              const option = enabledProviders.find((entry) => entry.provider === provider);
              if (option) onChange({ provider: option.provider });
            }}
          >
            {enabledProviders.map((option) => (
              <SelectItem key={option.provider} value={option.provider}>
                {option.label}
              </SelectItem>
            ))}
          </SettingsSelectControl>
        }
      />
      <SettingsRow
        title="Project or chat"
        description="A chat shows its live servers and loaded plugins; a project uses its native configuration."
        actions={
          <SettingsSelectControl
            value={value}
            valueContent={
              context.threadId
                ? (threads.find((thread) => thread.id === context.threadId)?.title ??
                  "Chat unavailable")
                : context.cwd
                  ? (projects.find((project) => project.cwd === context.cwd)?.name ?? context.cwd)
                  : "Provider defaults"
            }
            ariaLabel="Provider project or chat"
            onValueChange={(selected) => {
              const thread = threads.find((thread) => `thread:${thread.id}` === selected);
              if (thread) {
                const cwd =
                  thread.worktreePath ??
                  projects.find((project) => project.id === thread.projectId)?.cwd;
                onChange({
                  provider: context.provider,
                  threadId: thread.id,
                  ...(cwd ? { cwd } : {}),
                });
                return;
              }
              const project = projects.find((project) => `project:${project.cwd}` === selected);
              onChange({ provider: context.provider, ...(project ? { cwd: project.cwd } : {}) });
            }}
          >
            <SelectItem value="provider">Provider defaults</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={`project:${project.cwd}`}>
                {project.name}
              </SelectItem>
            ))}
            {threads.map((thread) => (
              <SelectItem key={thread.id} value={`thread:${thread.id}`}>
                Chat: {thread.title}
              </SelectItem>
            ))}
          </SettingsSelectControl>
        }
      />
    </SettingsSection>
  );
}
