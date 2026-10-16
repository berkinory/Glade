import type { NativeApi } from "@glade/contracts/ipc/ipc";
import type { McpConnector } from "@glade/contracts/transport/ws/mcpConnectorsRpc";
import { useState } from "react";

import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { Spinner } from "../../ui/spinner";
import { type AgentTarget, AgentTargetPicker } from "../AgentTargetPicker";

function AgentsForm(props: {
  readonly connector: McpConnector;
  readonly api: NativeApi["mcpConnectors"];
  readonly onClose: () => void;
}) {
  const [providers, setProviders] = useState<AgentTarget>(props.connector.providers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (providers !== null && providers.length === 0) {
      setError("Choose at least one agent.");
      return;
    }
    setSaving(true);
    props.api
      .setProviders({ connectorId: props.connector.connectorId, providers })
      .then(props.onClose)
      .catch((cause: unknown) => {
        setSaving(false);
        setError(cause instanceof Error ? cause.message : "Try again.");
      });
  };

  return (
    <>
      <DialogHeader className="px-5 pt-5">
        <DialogTitle>Agents for {props.connector.name}</DialogTitle>
        <DialogDescription>Applies to chats you start from now on.</DialogDescription>
      </DialogHeader>
      <DialogPanel className="mt-2 flex flex-col gap-3 px-5">
        <AgentTargetPicker value={providers} onChange={setProviders} disabled={saving} />
        {error ? (
          <p role="alert" className="text-ui-sm text-destructive">
            {error}
          </p>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={props.onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={saving} onClick={save}>
          {saving ? <Spinner className="size-4" /> : null}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

export function ConnectorAgentsDialog(props: {
  readonly connector: McpConnector | null;
  readonly api: NativeApi["mcpConnectors"];
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.connector !== null} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md">
        {props.connector ? (
          <AgentsForm
            key={props.connector.connectorId}
            connector={props.connector}
            api={props.api}
            onClose={() => props.onOpenChange(false)}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
