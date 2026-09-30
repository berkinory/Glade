import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ProviderManagementContext,
  ProviderManagePluginInput,
  ProviderManagementScope,
} from "@glade/contracts/provider/providerManagement";
import { ensureNativeApi } from "~/nativeApi";
import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SelectItem } from "../ui/select";
import { SettingsSelectControl } from "./SettingControls";
import {
  SettingsEmptyState,
  SettingsListRow as SettingsRow,
  SettingsSection,
} from "./SettingsPanelPrimitives";
import { ProviderManagementContextControls } from "./ProviderManagementContextControls";

const ACTION_LABELS = {
  install: "Install",
  remove: "Remove",
  enable: "Enable",
  disable: "Disable",
  reload: "Reload",
} as const;

export function PluginsSettingsPanel() {
  const [context, setContext] = useState<ProviderManagementContext>({ provider: "codex" });
  const [pluginId, setPluginId] = useState("");
  const [scope, setScope] = useState<ProviderManagementScope>("user");
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["provider-management", "plugins", context],
    queryFn: () => ensureNativeApi().provider.pluginInventory(context),
    staleTime: 10_000,
  });
  const mutation = useMutation({
    mutationFn: (input: ProviderManagePluginInput) =>
      ensureNativeApi().provider.managePlugin(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["provider-management"] }),
        queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all }),
      ]);
    },
  });
  return (
    <div className="space-y-6">
      <ProviderManagementContextControls
        context={context}
        onChange={(next) => {
          setContext(next);
          mutation.reset();
        }}
      />
      <SettingsSection title="Native plugin inventory">
        <SettingsRow
          title="Refresh plugins"
          description="Installed plugins and plugins loaded in the selected session are shown separately."
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
        {context.provider === "codex" ? (
          <SettingsRow
            title="Codex plugin library"
            description="Browse marketplaces, plugin details and availability."
            actions={
              <Link to="/plugins" className="text-ui text-primary hover:underline">
                Open library
              </Link>
            }
          />
        ) : null}
        {query.isPending ? (
          <SettingsEmptyState layout="status">Loading plugins…</SettingsEmptyState>
        ) : null}
        {query.error || query.data?.error ? (
          <SettingsEmptyState layout="status" tone="destructive">
            {query.error?.message ?? query.data?.error}
          </SettingsEmptyState>
        ) : null}
        {query.data?.plugins.map((plugin) => (
          <SettingsRow
            key={`${plugin.id}:${plugin.scope ?? "unknown"}`}
            title={plugin.name}
            description={
              <>
                {plugin.installed ? "Installed" : "Not installed"}
                {plugin.enabled !== undefined
                  ? ` · ${plugin.enabled ? "Enabled" : "Disabled"}`
                  : ""}
                {plugin.loaded !== undefined
                  ? ` · ${plugin.loaded ? "Loaded in session" : "Not loaded in session"}`
                  : ""}
                {plugin.version ? ` · ${plugin.version}` : ""}
                {plugin.scope ? ` · ${plugin.scope}` : ""}
                {plugin.error ? (
                  <span className="block text-destructive">{plugin.error}</span>
                ) : null}
              </>
            }
            actions={
              <div className="flex flex-wrap gap-1">
                {plugin.actions.map((action) => (
                  <Button
                    key={action}
                    variant="secondary"
                    size="sm"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        ...context,
                        id: plugin.id,
                        action,
                        ...(["user", "project", "local"].includes(plugin.scope ?? "")
                          ? { scope: plugin.scope as ProviderManagementScope }
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
        {query.data && !query.data.error && query.data.plugins.length === 0 ? (
          <SettingsEmptyState layout="status">
            No plugins installed in this context.
          </SettingsEmptyState>
        ) : null}
      </SettingsSection>
      {query.data?.canInstall && context.provider === "claudeAgent" ? (
        <SettingsSection title="Install plugin">
          <SettingsRow
            title="Native plugin identifier"
            description="Use name@marketplace from a marketplace configured in Claude Code."
            actions={
              <Input
                aria-label="Plugin identifier"
                value={pluginId}
                onChange={(event) => setPluginId(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="Installation scope"
            actions={
              <SettingsSelectControl
                value={scope}
                valueContent={scope}
                ariaLabel="Plugin installation scope"
                onValueChange={(value) => {
                  if (value === "user" || value === "project" || value === "local") setScope(value);
                }}
              >
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="local">Local</SelectItem>
              </SettingsSelectControl>
            }
          />
          <SettingsRow
            title="Install and reload"
            actions={
              <Button
                size="sm"
                disabled={mutation.isPending || !pluginId.trim()}
                onClick={() =>
                  mutation.mutate(
                    { ...context, id: pluginId.trim(), action: "install", scope },
                    {
                      onSuccess: (result) => {
                        if (result.applied) setPluginId("");
                      },
                    },
                  )
                }
              >
                Install
              </Button>
            }
          />
        </SettingsSection>
      ) : null}
      {mutation.error ? (
        <p role="alert" className="text-ui text-destructive">
          {mutation.error.message}
        </p>
      ) : null}
      {mutation.data ? (
        <p role="status" className="text-ui text-muted-foreground">
          {mutation.data.message ??
            (mutation.data.applied
              ? "Plugin configuration updated."
              : "No configuration change was applied.")}
        </p>
      ) : null}
    </div>
  );
}
