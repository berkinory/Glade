import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ProviderManagementContext,
  ProviderManageMcpServerInput,
} from "@glade/contracts/provider/providerManagement";
import { ensureNativeApi } from "~/nativeApi";
import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { Button } from "../ui/button";
import {
  SettingsEmptyState,
  SettingsListRow as SettingsRow,
  SettingsSection,
} from "./SettingsPanelPrimitives";
import { ProviderManagementContextControls } from "./ProviderManagementContextControls";
import { McpServerAddForm } from "./McpServerAddForm";

const ACTION_LABELS = {
  authenticate: "Authenticate",
  reconnect: "Reconnect",
  enable: "Enable",
  disable: "Disable",
  remove: "Remove",
} as const;

export function McpSettingsPanel() {
  const [context, setContext] = useState<ProviderManagementContext>({ provider: "codex" });
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["provider-management", "mcp", context],
    queryFn: () => ensureNativeApi().provider.listMcpServers(context),
    staleTime: 10_000,
  });
  const mutation = useMutation({
    mutationFn: (input: ProviderManageMcpServerInput) =>
      ensureNativeApi().provider.manageMcpServer(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["provider-management"] }),
        queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all }),
      ]);
    },
  });
  const result = mutation.data;
  return (
    <div className="space-y-6">
      <ProviderManagementContextControls
        context={context}
        onChange={(next) => {
          setContext(next);
          mutation.reset();
        }}
      />
      <SettingsSection title="Native MCP servers">
        <SettingsRow
          title="Refresh native status"
          description="Claude toggles affect the selected session. Codex reconnect reloads MCP servers across the provider runtime."
          actions={
            <Button
              size="sm"
              disabled={query.isFetching || mutation.isPending}
              onClick={() => void query.refetch()}
            >
              Refresh
            </Button>
          }
        />
        {query.isPending ? (
          <SettingsEmptyState layout="status">Loading servers…</SettingsEmptyState>
        ) : null}
        {query.error || query.data?.error ? (
          <SettingsEmptyState layout="status" tone="destructive">
            {query.error?.message ?? query.data?.error}
          </SettingsEmptyState>
        ) : null}
        {query.data?.servers.map((server) => (
          <SettingsRow
            key={server.id}
            title={server.name}
            description={
              <>
                {server.status} · {server.transport}
                {server.scope ? ` · ${server.scope}` : ""}
                {server.toolCount !== undefined ? ` · ${server.toolCount} tools` : ""}
                {server.managed ? " · Managed by Glade" : ""}
                {server.error ? (
                  <span className="block text-destructive">{server.error}</span>
                ) : null}
              </>
            }
            actions={
              <div className="flex flex-wrap gap-1">
                {server.actions.map((action) => (
                  <Button
                    key={action}
                    size="sm"
                    variant="secondary"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        ...context,
                        name: server.name,
                        action,
                        ...(["user", "project", "local"].includes(server.scope ?? "")
                          ? { scope: server.scope as "user" | "project" | "local" }
                          : {}),
                        ...((server.configVersion ?? query.data?.configVersion)
                          ? { expectedVersion: server.configVersion ?? query.data!.configVersion! }
                          : {}),
                      })
                    }
                  >
                    {ACTION_LABELS[action]}
                  </Button>
                ))}
              </div>
            }
          />
        ))}
        {query.data && !query.data.error && query.data.servers.length === 0 ? (
          <SettingsEmptyState layout="status">
            No servers configured in this context.
          </SettingsEmptyState>
        ) : null}
      </SettingsSection>
      {mutation.error ? (
        <p role="alert" className="text-ui text-destructive">
          {mutation.error.message}
        </p>
      ) : null}
      {result ? (
        <p role="status" className="text-ui text-muted-foreground">
          {result.message ??
            (result.applied
              ? `Updated ${result.affects === "session" ? "this session" : result.affects === "next-session" ? "the next session's configuration" : "the provider configuration"}.`
              : "No configuration change was applied.")}
          {result.authorizationUrl ? (
            <Button
              size="sm"
              onClick={() => void ensureNativeApi().shell.openExternal(result.authorizationUrl!)}
            >
              Open authentication
            </Button>
          ) : null}
        </p>
      ) : null}
      {query.data?.canAdd ? (
        <McpServerAddForm
          pending={mutation.isPending}
          onAdd={async (server) => {
            await mutation.mutateAsync({
              ...context,
              ...server,
              action: "add",
              ...(query.data?.configVersion ? { expectedVersion: query.data.configVersion } : {}),
            });
          }}
        />
      ) : null}
    </div>
  );
}
