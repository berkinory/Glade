import { useState } from "react";
import {
  addPairedMachine,
  connectRemoteEnvironment,
  removePairedMachine,
  useRemoteEnvironments,
  type RemoteEnvironment,
} from "~/environments/remoteEnvironments";
import { describeRemoteEnvironment } from "~/environments/remoteEnvironmentStatus";
import { ipcErrorMessage } from "~/lib/ipcErrorMessage";
import { Delete02Icon, PlusIcon } from "~/lib/icons";
import { readLocalNativeApi } from "~/nativeApi";
import { Button } from "../../ui/button";
import { MenuItem } from "../../ui/menu";
import { toastManager } from "../../ui/toast";
import { MachineRow } from "../machine/MachineRow";
import { SettingsCard, SettingsEmptyState, SettingsSectionShell } from "../SettingsPanelPrimitives";
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
          toastManager.add({
            type: "success",
            title: "Machine paired",
            description: `Paired with ${machine.label}.`,
          });
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
        title: "Could not remove machine",
        description: `Could not remove ${machine.host.label}. ${ipcErrorMessage(error, "Try again.")}`,
      }),
    );
  };
  return (
    <MachineRow
      environment={machine}
      address={URL.parse(machine.host.address)?.host ?? machine.host.address}
      action={
        status.reachable || needsPairing ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void connectRemoteEnvironment(machine).catch(() => undefined)}
          >
            Retry
          </Button>
        )
      }
      menuItems={
        <MenuItem variant="destructive" onClick={() => void remove()}>
          <Delete02Icon aria-hidden className="size-3.5" />
          Remove
        </MenuItem>
      }
    />
  );
}
