import { useState } from "react";
import {
  addPairedMachine,
  connectRemoteEnvironment,
  removePairedMachine,
  useRemoteEnvironments,
  type RemoteEnvironment,
} from "~/environments/remoteEnvironments";
import {
  describeRemoteEnvironment,
  remoteHostAvailability,
} from "~/environments/remoteEnvironmentStatus";
import { ipcErrorMessage } from "~/lib/ipcErrorMessage";
import { PlusIcon } from "~/lib/icons";
import { readLocalNativeApi } from "~/nativeApi";
import { HostStatusDot } from "../../HostStatusDot";
import { Button } from "../../ui/button";
import { toastManager } from "../../ui/toast";
import {
  SettingsCard,
  SettingsEmptyState,
  SettingsListRow,
  SettingsSectionShell,
} from "../SettingsPanelPrimitives";
import { PairMachineDialog } from "./PairMachineDialog";

type PairedEnvironment = Extract<RemoteEnvironment, { readonly kind: "paired" }>;

// The other direction of remote access: other machines' Glade that this app uses, like SSH hosts.
export function PairedMachinesSection() {
  const machines = useRemoteEnvironments().filter(
    (environment): environment is PairedEnvironment => environment.kind === "paired",
  );
  const [pairing, setPairing] = useState(false);
  if (!window.desktopBridge?.pairedMachines) return null;

  return (
    <SettingsSectionShell
      title="Other machines"
      action={
        <Button size="xs" variant="outline" onClick={() => setPairing(true)}>
          <PlusIcon aria-hidden />
          Pair with a machine
        </Button>
      }
    >
      <SettingsCard>
        {machines.length > 0 ? (
          machines.map((machine) => <PairedMachineRow key={machine.key} machine={machine} />)
        ) : (
          <SettingsEmptyState layout="status">
            Use another computer's Glade from here. Its projects appear in the sidebar with yours.
          </SettingsEmptyState>
        )}
      </SettingsCard>
      <PairMachineDialog
        open={pairing}
        onOpenChange={setPairing}
        onPair={async (link) => {
          const machine = await addPairedMachine(link);
          toastManager.add({ type: "success", title: `Paired with ${machine.label}` });
        }}
      />
    </SettingsSectionShell>
  );
}

function PairedMachineRow(props: { readonly machine: PairedEnvironment }) {
  const { machine } = props;
  const status = describeRemoteEnvironment(machine);
  const needsPairing = machine.connection?.issue === "needs-sign-in";
  const remove = async () => {
    const confirmed = await readLocalNativeApi()?.dialogs.confirm(
      `Remove ${machine.host.label}?\n\nThis app signs out of it. Its projects and chats stay there and come back if you pair again.`,
    );
    if (!confirmed) return;
    void removePairedMachine(machine.host.id).catch((error: unknown) =>
      toastManager.add({
        type: "error",
        title: `Could not remove ${machine.host.label}`,
        description: ipcErrorMessage(error, "Try again."),
      }),
    );
  };
  return (
    <SettingsListRow
      title={
        <span className="flex min-w-0 items-baseline gap-2">
          <HostStatusDot tone={remoteHostAvailability(machine).tone} className="self-center" />
          <span className="truncate">{machine.host.label}</span>
          <span className="truncate font-mono text-ui-xs font-normal text-muted-foreground">
            {URL.parse(machine.host.address)?.host ?? machine.host.address}
          </span>
        </span>
      }
      description={
        status.tone === "connected" ? status.label : (machine.connection?.detail ?? status.label)
      }
      actions={
        <>
          {status.reachable || needsPairing ? null : (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void connectRemoteEnvironment(machine).catch(() => undefined)}
            >
              Retry
            </Button>
          )}
          <Button size="xs" variant="outline" onClick={() => void remove()}>
            Remove
          </Button>
        </>
      }
    />
  );
}
