import {
  WS_GITHUB_PROJECT_PROVISIONING_CAPABILITY,
  WS_PROJECT_FILE_WATCH_CAPABILITY,
} from "@glade/contracts/transport/ws/wsCompatibility";
import { type NativeApi } from "@glade/contracts/ipc/ipc";

import { type EnvironmentKey } from "./environments/environmentKey";
import { createRoutedNativeApi, environmentApi } from "./environments/routedNativeApi";
import {
  createWsNativeApi,
  onWsServerCapabilitiesChange,
  readWsServerCapabilities,
} from "./wsNativeApi";

let cachedDesktopApi: NativeApi | undefined;
let routed: { readonly local: NativeApi; readonly api: NativeApi } | null = null;

// The local server's own API, for code that must talk to it whatever chat is on screen.
export function readLocalNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedDesktopApi && window.nativeApi === cachedDesktopApi) return cachedDesktopApi;

  if (window.nativeApi) {
    cachedDesktopApi = window.nativeApi;
    return cachedDesktopApi;
  }

  return createWsNativeApi();
}

// Routes each call to the environment its thread, project or path belongs to.
export function readNativeApi(): NativeApi | undefined {
  const local = readLocalNativeApi();
  if (!local) return undefined;
  if (routed?.local !== local) routed = { local, api: createRoutedNativeApi(local) };
  return routed.api;
}

// For calls that pick an environment on purpose, such as creating a project or chat on a host.
export function ensureEnvironmentNativeApi(key: EnvironmentKey): NativeApi {
  const local = readLocalNativeApi();
  if (!local) throw new Error("Native API not found");
  return environmentApi(key, local);
}

export function ensureNativeApi(): NativeApi {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API not found");
  }
  return api;
}

export function readNativeApiServerCapability(capability: string): boolean {
  if (typeof window === "undefined") return false;
  if (window.nativeApi) {
    if (capability === WS_GITHUB_PROJECT_PROVISIONING_CAPABILITY) {
      return typeof window.nativeApi.projects?.provisionFromGitHub === "function";
    }
    if (capability === WS_PROJECT_FILE_WATCH_CAPABILITY) {
      return typeof window.nativeApi.projects?.onFileChange === "function";
    }
    return false;
  }
  return readWsServerCapabilities()?.includes(capability) === true;
}

export function onNativeApiServerCapabilitiesChange(
  listener: () => void,
  options?: { readonly replayCurrent?: boolean },
): () => void {
  if (typeof window === "undefined") {
    if (options?.replayCurrent) listener();
    return () => undefined;
  }
  if (window.nativeApi) {
    if (options?.replayCurrent) listener();
    return () => undefined;
  }
  return onWsServerCapabilitiesChange(listener, options);
}
