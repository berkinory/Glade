import type { NativeApi } from "@glade/contracts/ipc/ipc";
import { useSyncExternalStore } from "react";

import { environmentWsUrl } from "~/environments/environmentEndpoints";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "~/environments/environmentKey";
import { type RemoteEnvironment, useRemoteEnvironments } from "~/environments/remoteEnvironments";
import { describeRemoteEnvironment } from "~/environments/remoteEnvironmentStatus";
import { ensureEnvironmentNativeApi } from "~/nativeApi";

// The machine whose agents, skills and connectors Settings shows. It starts on this machine each
// time Glade opens, so a change is never made on a host by surprise.
let selected: EnvironmentKey = LOCAL_ENVIRONMENT;
const listeners = new Set<() => void>();

export function setSettingsMachine(key: EnvironmentKey): void {
  if (selected === key) return;
  selected = key;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface SettingsMachine {
  readonly key: EnvironmentKey;
  readonly label: string;
  // Null for this machine.
  readonly remote: RemoteEnvironment | null;
  // Null while a host's server cannot be reached.
  readonly api: NativeApi | null;
  // Where a connector sign-in returns to reach this machine's server from this one's browser: an
  // SSH tunnel's local end. Undefined for this machine, which receives it directly.
  readonly callbackOrigin: string | undefined;
}

function tunnelOrigin(key: EnvironmentKey): string {
  const wsUrl = environmentWsUrl(key);
  if (!wsUrl) return "";
  const url = new URL(wsUrl);
  return `${url.protocol === "wss:" ? "https:" : "http:"}//${url.host}`;
}

export function useSettingsMachine(): SettingsMachine {
  const key = useSyncExternalStore(subscribe, () => selected);
  const environments = useRemoteEnvironments();
  // A host removed while selected falls back to this machine.
  const remote = environments.find((environment) => environment.key === key) ?? null;
  if (!remote) {
    return {
      key: LOCAL_ENVIRONMENT,
      label: "Local",
      remote: null,
      api: ensureEnvironmentNativeApi(LOCAL_ENVIRONMENT),
      callbackOrigin: undefined,
    };
  }
  return {
    key,
    label: remote.host.label,
    remote,
    api:
      remote.api && describeRemoteEnvironment(remote).reachable
        ? ensureEnvironmentNativeApi(key)
        : null,
    callbackOrigin: tunnelOrigin(key),
  };
}
