import type {
  RemoteAccessDevices,
  RemoteAccessStatus,
  RemoteAccessUpdateInput,
} from "@glade/contracts/transport/ws/remoteAccessRpc";
import type { AuthClientSession } from "@glade/contracts/transport/auth/auth";
import { useEffect, useState } from "react";

import { PlusIcon } from "~/lib/icons";
import { ensureNativeApi, readLocalNativeApi } from "~/nativeApi";
import { Button } from "../../ui/button";
import { Switch } from "../../ui/switch";
import { toastManager } from "../../ui/toast";
import {
  SettingsCard,
  SettingsEmptyState,
  SettingsListRow,
  SettingsRow,
  SettingsSectionShell,
} from "../SettingsPanelPrimitives";
import { PairDeviceDialog } from "./PairDeviceDialog";
import { deviceActivity, deviceName, reachabilityText } from "./remoteAccess.logic";

const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";

function reportError(title: string, error: unknown): void {
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "Try again.",
  });
}

function useRemoteAccessStatus(): RemoteAccessStatus | null {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  useEffect(() => ensureNativeApi().remoteAccess.onStatus(setStatus), []);
  return status;
}

function useRemoteAccessDevices(): RemoteAccessDevices | null {
  const [devices, setDevices] = useState<RemoteAccessDevices | null>(null);
  useEffect(() => ensureNativeApi().remoteAccess.onDevices(setDevices), []);
  return devices;
}

export function RemoteAccessSettingsPanel() {
  const status = useRemoteAccessStatus();
  const devices = useRemoteAccessDevices();
  const [pending, setPending] = useState(false);
  const [pairing, setPairing] = useState(false);

  if (!status) {
    return <SettingsEmptyState>Checking remote access…</SettingsEmptyState>;
  }

  const update = (input: RemoteAccessUpdateInput) => {
    setPending(true);
    void ensureNativeApi()
      .remoteAccess.update(input)
      .catch((error: unknown) => reportError("Could not change remote access", error))
      .finally(() => setPending(false));
  };

  // A fresh setup with Tailscale running gets its encrypted route straight away.
  const setEnabled = (enabled: boolean) =>
    update(
      enabled && !status.allowPlainHttp && status.tailscale.state === "running"
        ? { enabled, tailscaleHttps: true }
        : { enabled },
    );

  const setPlainHttp = async (allow: boolean) => {
    if (allow) {
      const confirmed = await readLocalNativeApi()?.dialogs.confirm(
        "Allow unencrypted connections?\n\nDevices on your Wi-Fi or VPN will reach Glade over plain HTTP. Anyone on the same network could read that traffic. Only do this on networks you trust.",
      );
      if (!confirmed) return;
    }
    update({ allowPlainHttp: allow });
  };

  const openExternal = (url: string) => void readLocalNativeApi()?.shell.openExternal(url);
  const reachability = reachabilityText(status);
  const canPair = status.enabled && status.routes.length > 0;

  return (
    <div className="space-y-6">
      <SettingsSectionShell title="Access">
        <SettingsCard>
          <SettingsRow
            id="setting-remote-access"
            title="Allow other devices"
            description="Use Glade from your phone or another computer. Each device has to be paired first, and works only while this machine is awake."
            status={reachability}
            control={
              <Switch
                checked={status.enabled}
                disabled={pending}
                onCheckedChange={(checked) => setEnabled(Boolean(checked))}
                aria-label="Allow other devices"
              />
            }
          />
          {status.enabled ? (
            <>
              <TailscaleRow
                status={status}
                pending={pending}
                onToggle={(on) => update({ tailscaleHttps: on })}
                onOpen={openExternal}
              />
              <SettingsRow
                id="setting-remote-access-local-network"
                title="Local network"
                description="Devices on the same Wi-Fi or VPN connect without encryption. Turn this on only for networks you trust."
                control={
                  <Switch
                    checked={status.allowPlainHttp}
                    disabled={pending}
                    onCheckedChange={(checked) => void setPlainHttp(Boolean(checked))}
                    aria-label="Local network"
                  />
                }
              />
            </>
          ) : null}
        </SettingsCard>
      </SettingsSectionShell>

      <SettingsSectionShell
        title="Devices"
        action={
          <Button size="xs" variant="outline" disabled={!canPair} onClick={() => setPairing(true)}>
            <PlusIcon aria-hidden />
            Pair a device
          </Button>
        }
      >
        <SettingsCard>
          {devices && devices.devices.length > 0 ? (
            devices.devices.map((device) => <DeviceRow key={device.sessionId} device={device} />)
          ) : (
            <SettingsEmptyState layout="status">
              {canPair
                ? "No devices yet. Pair your phone to follow chats and answer agents away from this computer."
                : "Turn on remote access and a way to reach this machine to pair a device."}
            </SettingsEmptyState>
          )}
        </SettingsCard>
      </SettingsSectionShell>

      <PairDeviceDialog
        open={pairing}
        pendingPairingIds={devices?.pendingPairingIds ?? []}
        onOpenChange={setPairing}
      />
    </div>
  );
}

function TailscaleRow(props: {
  readonly status: RemoteAccessStatus;
  readonly pending: boolean;
  readonly onToggle: (on: boolean) => void;
  readonly onOpen: (url: string) => void;
}) {
  const { tailscale } = props.status;
  const description =
    tailscale.state === "not-installed"
      ? "Install Tailscale here and on your devices for encrypted access from anywhere."
      : tailscale.state === "stopped"
        ? "Tailscale is installed but not connected. Open it and sign in."
        : "Encrypted access from your devices on your tailnet, at home or away.";
  const status = tailscale.setupUrl ? (
    <span className="flex flex-wrap items-center gap-2">
      HTTPS is off for your tailnet.
      <Button size="xs" variant="outline" onClick={() => props.onOpen(tailscale.setupUrl!)}>
        Turn it on in Tailscale
      </Button>
      <Button size="xs" variant="ghost" onClick={() => props.onToggle(true)}>
        Try again
      </Button>
    </span>
  ) : (
    (tailscale.error ?? (tailscale.httpsUrl ? `Serving ${tailscale.httpsUrl}` : null))
  );
  return (
    <SettingsRow
      id="setting-remote-access-tailscale"
      title="Tailscale HTTPS"
      description={description}
      status={tailscale.state === "running" ? status : null}
      control={
        tailscale.state === "not-installed" ? (
          <Button size="xs" variant="outline" onClick={() => props.onOpen(TAILSCALE_DOWNLOAD_URL)}>
            Get Tailscale
          </Button>
        ) : (
          <Switch
            checked={tailscale.httpsRequested}
            disabled={props.pending || tailscale.state !== "running"}
            onCheckedChange={(checked) => props.onToggle(Boolean(checked))}
            aria-label="Tailscale HTTPS"
          />
        )
      }
    />
  );
}

function DeviceRow(props: { readonly device: AuthClientSession }) {
  const { device } = props;
  const remove = async () => {
    const name = deviceName(device);
    const confirmed = await readLocalNativeApi()?.dialogs.confirm(
      `Remove ${name}?\n\nIt is signed out right away and has to be paired again to come back.`,
    );
    if (!confirmed) return;
    void ensureNativeApi()
      .remoteAccess.revokeDevice({ sessionId: device.sessionId })
      .catch((error: unknown) => reportError(`Could not remove ${name}`, error));
  };
  return (
    <SettingsListRow
      title={deviceName(device)}
      description={deviceActivity(device)}
      actions={
        <Button size="xs" variant="outline" onClick={() => void remove()}>
          Remove
        </Button>
      }
    />
  );
}
