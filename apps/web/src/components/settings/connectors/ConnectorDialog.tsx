import type { NativeApi } from "@glade/contracts/ipc/ipc";
import type {
  McpConnectorConnectInput,
  McpConnectorsState,
} from "@glade/contracts/transport/ws/mcpConnectorsRpc";
import { normalizeMcpConnectorUrl } from "@glade/shared/mcpConnectors/catalog";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";

import {
  ArrowUpRightIcon,
  BotIcon,
  CheckmarkCircle02Icon,
  LockKeyholeIcon,
  ShieldCheckIcon,
} from "~/lib/icons";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  dialogFieldLabelClassName,
} from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Spinner } from "../../ui/spinner";
import { ConnectorIcon } from "./ConnectorIcon";
import { connectorHost, type ConnectorTarget, targetIconUrl, targetName } from "./connectors.logic";

type ConnectorsApi = NativeApi["mcpConnectors"];

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "connecting" }
  | {
      readonly kind: "waiting";
      readonly attemptId: string;
      readonly authorizationUrl: string;
      readonly url: string;
      readonly startedAt: number;
    }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "connected" };

const CLOSE_AFTER_CONNECTED_MS = 1_200;

interface ConnectorDialogProps {
  readonly target: ConnectorTarget | null;
  readonly state: McpConnectorsState | null;
  readonly api: ConnectorsApi;
  readonly openExternal: (url: string) => void;
  readonly onOpenChange: (open: boolean) => void;
}

export function ConnectorDialog(props: ConnectorDialogProps) {
  const { target } = props;
  return (
    <Dialog open={target !== null} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md">
        {target ? (
          <ConnectorDialogContent
            key={target.kind === "preset" ? target.preset.id : `custom:${target.url}`}
            {...props}
            target={target}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function Fact(props: { readonly icon: ReactNode; readonly children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&>svg]:size-4">{props.icon}</span>
      <span className="text-ui-sm leading-snug text-muted-foreground">{props.children}</span>
    </li>
  );
}

function Field(props: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={dialogFieldLabelClassName}>{props.label}</span>
      {props.children}
      {props.hint ? <span className="text-ui-xs text-muted-foreground">{props.hint}</span> : null}
    </label>
  );
}

function ConnectorDialogContent(
  props: ConnectorDialogProps & { readonly target: ConnectorTarget },
) {
  const { target, state, api, openExternal, onOpenChange } = props;
  const formId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [url, setUrl] = useState(target.kind === "custom" ? target.url : "");
  const [name, setName] = useState(target.kind === "custom" ? target.name : "");
  const [token, setToken] = useState("");
  // The state stream learns about a sign-in a moment after `connect` returns; until it has listed
  // the attempt, its absence does not mean the sign-in ended.
  const [listedAttempt, setListedAttempt] = useState<string | null>(null);

  const preset = target.kind === "preset" ? target.preset : null;
  const needsToken = preset?.auth === "token";
  const displayName = preset
    ? preset.name
    : name.trim() || (url.trim() ? connectorHost(url.trim()) : targetName(target));

  if (phase.kind === "waiting") {
    const signIn = state?.signIns.find((entry) => entry.attemptId === phase.attemptId);
    if (signIn) {
      if (listedAttempt !== phase.attemptId) setListedAttempt(phase.attemptId);
      if (signIn.state === "failed") {
        setPhase({
          kind: "failed",
          message: signIn.message ?? `${displayName} did not finish the sign-in.`,
        });
      }
    } else if (listedAttempt === phase.attemptId) {
      // A reconnect keeps the old record until the new sign-in saves, so only a record written
      // after this sign-in started proves it finished.
      const connected = state?.connectors.some(
        (connector) =>
          connector.url === phase.url &&
          connector.status === "connected" &&
          Date.parse(connector.connectedAt) >= phase.startedAt,
      );
      setPhase(
        connected
          ? { kind: "connected" }
          : { kind: "failed", message: "The sign-in ended before it finished. Try again." },
      );
    }
  }

  useEffect(() => {
    if (phase.kind !== "connected") return;
    const timer = window.setTimeout(() => onOpenChange(false), CLOSE_AFTER_CONNECTED_MS);
    return () => window.clearTimeout(timer);
  }, [phase.kind, onOpenChange]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedToken = token.trim();
    let input: McpConnectorConnectInput;
    let targetUrl: string;
    if (preset) {
      if (needsToken && !trimmedToken) {
        setPhase({ kind: "failed", message: `Enter a ${preset.name} token.` });
        return;
      }
      input = { presetId: preset.id, ...(trimmedToken ? { token: trimmedToken } : {}) };
      targetUrl = preset.url;
    } else {
      const checked = normalizeMcpConnectorUrl(url);
      if (!checked.ok) {
        setPhase({ kind: "failed", message: checked.reason });
        return;
      }
      input = {
        url: checked.url,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(trimmedToken ? { token: trimmedToken } : {}),
      };
      targetUrl = checked.url;
    }
    setPhase({ kind: "connecting" });
    const startedAt = Date.now();
    api
      .connect(input)
      .then((result) => {
        if (result.kind === "connected") {
          setPhase({ kind: "connected" });
          return;
        }
        setPhase({
          kind: "waiting",
          attemptId: result.attemptId,
          authorizationUrl: result.authorizationUrl,
          url: targetUrl,
          startedAt,
        });
        openExternal(result.authorizationUrl);
      })
      .catch((error: unknown) => {
        setPhase({
          kind: "failed",
          message:
            error instanceof Error ? error.message : `Glade could not connect ${displayName}.`,
        });
      });
  };

  const cancelSignIn = () => {
    if (phase.kind === "waiting") void api.cancelSignIn({ attemptId: phase.attemptId });
    setPhase({ kind: "idle" });
  };

  const busy = phase.kind === "connecting";
  const editable = phase.kind === "idle" || phase.kind === "failed";
  const secretLabel = needsToken || token.trim() ? "token" : "sign-in";
  const host = preset ? connectorHost(preset.url) : url.trim() ? connectorHost(url.trim()) : null;

  if (phase.kind === "connected") {
    return (
      <DialogPanel className="flex flex-col items-center gap-2 px-5 py-10 text-center">
        <CheckmarkCircle02Icon aria-hidden className="size-10 text-success" />
        <p className="text-ui-lg font-medium">{displayName} is connected</p>
        <p className="text-ui-sm text-muted-foreground">New chats can use its tools.</p>
      </DialogPanel>
    );
  }

  return (
    <>
      <DialogHeader className="px-5 pt-5">
        <div className="mb-2">
          <ConnectorIcon
            brand={preset ? [preset.id, preset.name] : [name]}
            url={preset ? targetIconUrl(target) : url.trim() || "custom"}
            size="lg"
          />
        </div>
        <DialogTitle>{preset ? `Connect ${preset.name}` : "Add a custom connector"}</DialogTitle>
        <DialogDescription>
          {preset ? preset.description : "Any remote MCP server that speaks Streamable HTTP."}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="px-5">
        {phase.kind === "waiting" ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Spinner className="size-5 text-muted-foreground" />
            <p className="text-ui">Finish signing in to {displayName} in your browser.</p>
            <Button size="sm" variant="ghost" onClick={() => openExternal(phase.authorizationUrl)}>
              Open the sign-in page again
              <ArrowUpRightIcon aria-hidden />
            </Button>
          </div>
        ) : (
          <form id={formId} className="mt-3 flex flex-col gap-4" onSubmit={submit} noValidate>
            {preset ? null : (
              <>
                <Field label="Server URL">
                  <Input
                    value={url}
                    maxLength={2048}
                    placeholder="https://mcp.example.com/mcp"
                    autoFocus
                    disabled={!editable}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </Field>
                <Field label="Name" hint="Optional. Shown here and to agents.">
                  <Input
                    value={name}
                    maxLength={80}
                    placeholder={url.trim() ? connectorHost(url.trim()) : "My server"}
                    disabled={!editable}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
              </>
            )}
            {preset === null || preset.tokenUrl ? (
              <Field
                label={
                  needsToken ? `${preset?.name} token` : preset ? `${preset.name} API key` : "Token"
                }
                hint={
                  preset?.tokenUrl ? (
                    <span>
                      {needsToken ? null : "Optional, for higher limits. "}
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
                        onClick={() => openExternal(preset.tokenUrl ?? "")}
                      >
                        {needsToken ? "Create a token" : "Get a key"}
                        <ArrowUpRightIcon aria-hidden className="size-3" />
                      </button>
                    </span>
                  ) : (
                    "Optional. Only for servers that take an API key instead of a sign-in."
                  )
                }
              >
                <Input
                  type="password"
                  value={token}
                  autoComplete="off"
                  autoFocus={needsToken}
                  disabled={!editable}
                  onChange={(event) => setToken(event.target.value)}
                />
              </Field>
            ) : null}
            <ul className="flex flex-col gap-2.5">
              <Fact icon={<BotIcon aria-hidden />}>
                Agents in new chats can use {displayName}’s tools. Each call follows the chat’s
                approval mode.
              </Fact>
              <Fact icon={<LockKeyholeIcon aria-hidden />}>
                {preset?.auth === "none" && !token.trim()
                  ? `${preset.name} is public and needs no sign-in.`
                  : `Glade keeps the ${secretLabel} on this computer. Agents never see it.`}
              </Fact>
              <Fact icon={<ShieldCheckIcon aria-hidden />}>
                Connect only services you trust: what they return reaches your agents.
              </Fact>
            </ul>
            {host ? (
              <p className="truncate text-ui-xs text-muted-foreground">Server: {host}</p>
            ) : null}
            {phase.kind === "failed" ? (
              <p role="alert" className="text-ui-sm text-destructive">
                {phase.message}
              </p>
            ) : null}
          </form>
        )}
      </DialogPanel>
      <DialogFooter>
        {phase.kind === "waiting" ? (
          <Button type="button" variant="outline" onClick={cancelSignIn}>
            Cancel sign-in
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={busy || (preset === null && !url.trim())}>
              {busy ? <Spinner className="size-4" /> : null}
              {preset?.auth === "oauth" ? `Continue to ${preset.name}` : "Connect"}
              {preset?.auth === "oauth" && !busy ? <ArrowUpRightIcon aria-hidden /> : null}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
