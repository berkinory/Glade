import { useState } from "react";
import type { ProviderManagementContext } from "@glade/contracts/provider/providerManagement";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";
import { SelectItem } from "../ui/select";
import { SettingsSelectControl } from "./SettingControls";
import { SettingsListRow as SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

export function ProviderManagementContextControls({
  context,
  onChange,
}: {
  context: ProviderManagementContext;
  onChange: (context: ProviderManagementContext) => void;
}) {
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
              if (provider === "codex" || provider === "claudeAgent") onChange({ provider });
            }}
          >
            <SelectItem value="codex">Codex</SelectItem>
            <SelectItem value="claudeAgent">Claude</SelectItem>
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
