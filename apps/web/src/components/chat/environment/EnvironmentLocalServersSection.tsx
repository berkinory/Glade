import { CpuIcon, RefreshCwIcon, SquareFilledIcon } from "~/lib/icons";
import { Spinner } from "~/components/ui/spinner";
import type { ReactNode } from "react";
import type { ServerLocalServerProcess } from "@glade/contracts/server/server";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useStore } from "~/store";
import type { WorkLogBackgroundTask } from "~/workLog.types";
import { stopWorkflowTask } from "../chatTaskActions";
import { useThreadBackgroundTasks } from "./useThreadBackgroundTasks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { localServerPrimaryLabel } from "~/lib/localServers";
import { LocalServerIdentity } from "../../LocalServerIdentity";
import { ComposerPickerMenuPopup } from "../ComposerPickerMenuPopup";
import { Menu, MenuItem, MenuTrigger } from "../../ui/menu";
import {
  serverLocalServersQueryOptions,
  serverStopLocalServerMutationOptions,
} from "~/lib/serverReactQuery";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentRowBody,
  EnvironmentRowChevron,
} from "./EnvironmentRow";
function describeServerCount(count: number): string {
  if (count === 0) return "No servers running";
  return `${count} server${count === 1 ? "" : "s"} running`;
}
function LocalServersRefreshButton({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <MenuItem
      closeOnClick={false}
      disabled={refreshing}
      onClick={onRefresh}
      aria-label="Refresh local servers"
      title="Refresh"
      className="inline-flex size-5 items-center justify-center rounded-md p-0 text-muted-foreground/60 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)] data-highlighted:bg-[var(--color-background-button-secondary-hover)] data-highlighted:text-[var(--color-text-foreground)]"
    >
      {refreshing ? (
        <Spinner variant="action" aria-hidden="true" className="size-3" />
      ) : (
        <RefreshCwIcon className="size-3" />
      )}
    </MenuItem>
  );
}
function agentNote(
  server: ServerLocalServerProcess,
  chatTask: WorkLogBackgroundTask | undefined,
): string | null {
  if (!server.startedByAgent) return null;
  if (!chatTask) return "Started by an agent";
  return chatTask.description
    ? `Started by this chat · ${chatTask.description}`
    : "Started by this chat";
}

function LocalServerRow({
  server,
  chatTask,
  stopping,
  onStop,
}: {
  server: ServerLocalServerProcess;
  // The running background task of the open chat that serves this port, if any.
  chatTask: WorkLogBackgroundTask | undefined;
  stopping: boolean;
  onStop: (server: ServerLocalServerProcess) => void;
}) {
  const note = agentNote(server, chatTask);
  const stoppable = server.isStoppable && !stopping;
  const primaryLabel = localServerPrimaryLabel(server);
  const stopHint = server.isStoppable
    ? `Stop ${primaryLabel}`
    : (server.stopDisabledReason ?? server.args ?? server.displayName);
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[0.5rem] py-0.5 pl-2 pr-2.5">
      {}
      <span className="relative flex size-2 shrink-0 items-center justify-center" aria-hidden>
        <span className="absolute size-2 rounded-full bg-success/25" />
        <span className="relative size-1 rounded-full bg-success" />
      </span>

      <span className="min-w-0">
        <LocalServerIdentity server={server} tone="menu" />
        {note ? (
          <span
            className="mt-0.5 block truncate text-ui-xs leading-tight text-muted-foreground/65"
            title={note}
          >
            {note}
          </span>
        ) : null}
      </span>

      <MenuItem
        closeOnClick={false}
        disabled={!stoppable}
        onClick={() => onStop(server)}
        aria-label={stopHint}
        title={stopHint}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground/70 transition-colors hover:bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] hover:text-destructive data-highlighted:bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] data-highlighted:text-destructive data-disabled:text-muted-foreground/30 data-disabled:hover:bg-transparent data-disabled:hover:text-muted-foreground/30"
      >
        {stopping ? (
          <Spinner variant="action" className="size-3.5" />
        ) : (
          <SquareFilledIcon className="size-3.5" />
        )}
      </MenuItem>
    </div>
  );
}
function LocalServersPlaceholder({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-3 text-center">
      <span className="text-muted-foreground/40">{icon}</span>
      <span className="text-ui text-muted-foreground">{title}</span>
      {subtitle ? <span className="text-ui-xs text-muted-foreground/60">{subtitle}</span> : null}
    </div>
  );
}
export function EnvironmentLocalServersSection({
  enabled,
  threadId,
}: {
  enabled: boolean;
  threadId: ThreadId | null;
}) {
  const queryClient = useQueryClient();
  const setError = useStore((store) => store.setError);
  const runningChatTaskById = new Map(
    useThreadBackgroundTasks(threadId)
      .filter((task) => task.status === "running")
      .map((task) => [task.taskId, task]),
  );
  const chatTaskOf = (server: ServerLocalServerProcess) => {
    const taskId = server.startedByAgent?.taskId;
    return taskId ? runningChatTaskById.get(taskId) : undefined;
  };
  const localServersQuery = useQuery(serverLocalServersQueryOptions(enabled));
  const stopLocalServerMutation = useMutation(
    serverStopLocalServerMutationOptions({
      queryClient,
    }),
  );
  const servers = localServersQuery.data?.servers ?? [];
  const serverCount = servers.length;
  const isBusy = localServersQuery.isFetching || stopLocalServerMutation.isPending;
  const activeStoppingPid = stopLocalServerMutation.variables?.pid ?? null;
  const trailing = (
    <>
      {isBusy ? (
        <Spinner
          variant="action"
          className="size-3  text-[var(--color-text-foreground-secondary)]"
        />
      ) : (
        <span className="flex items-center gap-1.5">
          {serverCount > 0 ? (
            <span className="size-1.5 rounded-full bg-success" aria-hidden />
          ) : null}
          <span className="text-ui-sm tabular-nums text-[var(--color-text-foreground-secondary)]">
            {serverCount}
          </span>
        </span>
      )}
      <EnvironmentRowChevron />
    </>
  );
  return (
    <Menu>
      <MenuTrigger render={<button type="button" className={ENVIRONMENT_ROW_CLASS_NAME} />}>
        <EnvironmentRowBody
          icon={<CpuIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
          label="Local Servers"
          trailing={trailing}
        />
      </MenuTrigger>
      <ComposerPickerMenuPopup align="start" side="bottom" className="w-72 min-w-72">
        <div className="flex items-center justify-between gap-2 pb-0.5 pl-2 pr-3 pt-px">
          <span className="truncate text-ui-xs font-normal text-muted-foreground/50">
            {localServersQuery.isLoading ? "Scanning ports…" : describeServerCount(serverCount)}
          </span>
          <LocalServersRefreshButton
            refreshing={localServersQuery.isFetching}
            onRefresh={() => void localServersQuery.refetch()}
          />
        </div>

        {localServersQuery.isLoading ? (
          <LocalServersPlaceholder
            icon={<Spinner variant="action" className="size-4" />}
            title="Scanning local ports"
          />
        ) : localServersQuery.isError ? (
          <LocalServersPlaceholder
            icon={<CpuIcon className="size-4" />}
            title="Couldn't scan local ports"
            subtitle={
              localServersQuery.error instanceof Error
                ? localServersQuery.error.message
                : "The scan failed. Try refreshing."
            }
          />
        ) : serverCount === 0 ? (
          <LocalServersPlaceholder
            icon={<CpuIcon className="size-4" />}
            title="No servers running"
            subtitle="Local dev servers will appear here."
          />
        ) : (
          <div className="flex flex-col gap-0.5">
            {servers.map((server) => (
              <LocalServerRow
                key={server.id}
                server={server}
                chatTask={chatTaskOf(server)}
                stopping={activeStoppingPid === server.pid && stopLocalServerMutation.isPending}
                onStop={(selectedServer) => {
                  // Stopping through the task tells the agent its server is gone.
                  const chatTask = chatTaskOf(selectedServer);
                  if (chatTask && threadId) {
                    void stopWorkflowTask(threadId, chatTask.taskId)
                      .then(() => localServersQuery.refetch())
                      .catch((error: unknown) => {
                        setError(
                          threadId,
                          error instanceof Error ? error.message : "Could not stop the task.",
                        );
                      });
                    return;
                  }
                  stopLocalServerMutation.mutate({
                    pid: selectedServer.pid,
                    port: selectedServer.ports[0] ?? 1,
                  });
                }}
              />
            ))}
          </div>
        )}
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
