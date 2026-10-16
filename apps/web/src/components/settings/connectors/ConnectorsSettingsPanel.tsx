import type { NativeApi } from "@glade/contracts/ipc/ipc";
import type {
  McpConnector,
  McpConnectorSignIn,
  McpConnectorsState,
} from "@glade/contracts/transport/ws/mcpConnectorsRpc";
import { type ReactNode, useDeferredValue, useEffect, useState } from "react";

import { Delete02Icon, EllipsisIcon, PlusIcon, RefreshCwIcon } from "~/lib/icons";
import { LOCAL_ENVIRONMENT } from "~/environments/environmentKey";
import { ensureEnvironmentNativeApi } from "~/nativeApi";
import { Button } from "../../ui/button";
import { Menu, MenuItem, MenuTrigger } from "../../ui/menu";
import { SearchInput } from "../../ui/search-input";
import { Spinner } from "../../ui/spinner";
import { toastManager } from "../../ui/toast";
import { ComposerPickerMenuPopup } from "../../chat/ComposerPickerMenuPopup";
import { SettingsCard, SettingsEmptyState, SettingsSectionShell } from "../SettingsPanelPrimitives";
import { AgentMcpServersSection } from "./AgentMcpServersSection";
import { ConnectorDialog } from "./ConnectorDialog";
import { ConnectorIcon } from "./ConnectorIcon";
import { useAgentServerRemoval } from "./useAgentServerRemoval";
import {
  type AgentServerRow,
  catalogShelves,
  connectorHost,
  connectorIconUrl,
  connectorPreset,
  type ConnectorTarget,
  filterConnected,
  targetForConnector,
} from "./connectors.logic";

type ConnectorsApi = NativeApi["mcpConnectors"];

function useConnectorsState(api: ConnectorsApi): McpConnectorsState | null {
  const [state, setState] = useState<McpConnectorsState | null>(null);
  useEffect(() => api.onState(setState), [api]);
  return state;
}

const ROW_CLASS_NAME = "flex min-w-0 items-center gap-3 px-3 py-2.5";

function RowText(props: { readonly title: string; readonly description: ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-ui font-medium text-foreground">{props.title}</span>
      <span className="block truncate text-ui-sm text-muted-foreground">{props.description}</span>
    </span>
  );
}

function ConnectedRow(props: {
  readonly connector: McpConnector;
  readonly onReconnect: () => void;
  readonly onDisconnect: () => void;
}) {
  const { connector } = props;
  const needsSignIn = connector.status === "needs-sign-in";
  return (
    <div className={ROW_CLASS_NAME}>
      <ConnectorIcon
        presetId={connector.presetId}
        name={connector.name}
        url={connectorIconUrl(connector)}
      />
      <RowText
        title={connector.name}
        description={
          needsSignIn ? (
            <span className="text-destructive">Signed out. Reconnect to keep using it.</span>
          ) : (
            (connectorPreset(connector)?.description ?? connectorHost(connector.url))
          )
        }
      />
      {needsSignIn ? (
        <Button size="sm" variant="outline" onClick={props.onReconnect}>
          Reconnect
        </Button>
      ) : null}
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`More actions for ${connector.name}`}
            />
          }
        >
          <EllipsisIcon aria-hidden />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="end">
          {needsSignIn ? null : (
            <MenuItem onClick={props.onReconnect}>
              <RefreshCwIcon aria-hidden className="size-3.5 opacity-70" />
              Reconnect
            </MenuItem>
          )}
          <MenuItem variant="destructive" onClick={props.onDisconnect}>
            <Delete02Icon aria-hidden className="size-3.5" />
            Disconnect
          </MenuItem>
        </ComposerPickerMenuPopup>
      </Menu>
    </div>
  );
}

function SignInRow(props: { readonly signIn: McpConnectorSignIn; readonly onDismiss: () => void }) {
  const { signIn } = props;
  const failed = signIn.state === "failed";
  return (
    <div className={ROW_CLASS_NAME}>
      <span className="inline-flex size-8 shrink-0 items-center justify-center">
        {failed ? null : <Spinner className="size-4 text-muted-foreground" />}
      </span>
      <RowText
        title={signIn.name}
        description={
          failed ? (
            <span className="text-destructive">{signIn.message ?? "The sign-in failed."}</span>
          ) : (
            "Waiting for the sign-in in your browser…"
          )
        }
      />
      <Button size="sm" variant="ghost" onClick={props.onDismiss}>
        {failed ? "Dismiss" : "Cancel"}
      </Button>
    </div>
  );
}

export function ConnectorsSettingsPanel() {
  const localApi = ensureEnvironmentNativeApi(LOCAL_ENVIRONMENT);
  const api = localApi.mcpConnectors;
  const state = useConnectorsState(api);
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search).trim().toLowerCase();
  const [target, setTarget] = useState<ConnectorTarget | null>(null);
  // The agent server picked with Use in Glade, offered for removal once the service connects.
  const [moving, setMoving] = useState<AgentServerRow | null>(null);
  const removal = useAgentServerRemoval();

  const openExternal = (url: string) => {
    void localApi.shell
      .openExternal(url)
      .catch(() => toastManager.add({ type: "error", title: "Could not open the browser" }));
  };

  const disconnect = async (connector: McpConnector) => {
    const confirmed = await localApi.dialogs.confirm(
      `Disconnect ${connector.name}?\nAgents lose its tools, and Glade deletes its sign-in from this computer.`,
    );
    if (!confirmed) return;
    await api.disconnect({ connectorId: connector.connectorId }).catch((error: unknown) =>
      toastManager.add({
        type: "error",
        title: `Could not disconnect ${connector.name}`,
        description: error instanceof Error ? error.message : "Try again.",
      }),
    );
  };

  const connectors = state?.connectors ?? [];
  const connected = filterConnected(connectors, query);
  const signIns = (state?.signIns ?? []).filter((signIn) =>
    signIn.name.toLowerCase().includes(query),
  );
  const shelves = catalogShelves(
    query,
    new Set(connectors.flatMap((connector) => (connector.presetId ? [connector.presetId] : []))),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search connectors"
          aria-label="Search connectors"
        />
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() => setTarget({ kind: "custom", url: "", name: "" })}
        >
          <PlusIcon aria-hidden />
          Add custom
        </Button>
      </div>

      <SettingsSectionShell title="Connected">
        {state === null ? (
          <SettingsEmptyState layout="status">Loading connectors…</SettingsEmptyState>
        ) : connected.length === 0 && signIns.length === 0 ? (
          <SettingsEmptyState layout="status">
            {query
              ? "No connected service matches your search."
              : "Connect a service once and agents in every new chat can use its tools. Glade keeps the sign-in on this computer; agents never see it."}
          </SettingsEmptyState>
        ) : (
          <SettingsCard>
            {signIns.map((signIn) => (
              <SignInRow
                key={signIn.attemptId}
                signIn={signIn}
                onDismiss={() => void api.cancelSignIn({ attemptId: signIn.attemptId })}
              />
            ))}
            {connected.map((connector) => (
              <ConnectedRow
                key={connector.connectorId}
                connector={connector}
                onReconnect={() => setTarget(targetForConnector(connector))}
                onDisconnect={() => void disconnect(connector)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSectionShell>

      {shelves.length === 0 && query ? (
        <SettingsEmptyState>
          Nothing in the catalog matches “{search.trim()}”. Add it with its server URL instead.
        </SettingsEmptyState>
      ) : null}

      {shelves.map((shelf) => (
        <SettingsSectionShell key={shelf.id} title={shelf.label}>
          <SettingsCard divided={false} className="grid grid-cols-1 gap-0.5 p-1 sm:grid-cols-2">
            {shelf.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setTarget({ kind: "preset", preset })}
                className="group flex min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-[var(--color-background-elevated-secondary)] focus-visible:ring-1 focus-visible:ring-ring/60"
              >
                <ConnectorIcon presetId={preset.id} name={preset.name} url={preset.homepage} />
                <RowText title={preset.name} description={preset.description} />
                <PlusIcon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                />
              </button>
            ))}
          </SettingsCard>
        </SettingsSectionShell>
      ))}

      <AgentMcpServersSection
        connectors={connectors}
        query={query}
        removing={removal.removing}
        onRemove={(row) => void removal.remove(row)}
        onUseInGlade={(row) => {
          if (!row.preset) return;
          setMoving(row);
          setTarget({ kind: "preset", preset: row.preset });
        }}
      />

      <ConnectorDialog
        target={target}
        state={state}
        api={api}
        openExternal={openExternal}
        onOpenChange={(open) => {
          if (open) return;
          setTarget(null);
          setMoving(null);
          const connected =
            moving?.preset &&
            connectors.some((connector) => connector.presetId === moving.preset?.id);
          if (moving && connected) void removal.remove(moving);
        }}
      />
    </div>
  );
}
