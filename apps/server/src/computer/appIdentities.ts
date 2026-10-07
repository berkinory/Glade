import type { AppIdentity } from "./appCategories.ts";

// The app identity (bundle id, executable) behind a window's pid, from Cua's list_apps, so the
// category check at action time does not list every installed app on each call. Keyed by pid and
// the window's app name, which covers pid reuse after an app quits.
export interface AppIdentities {
  readonly get: (pid: number, windowAppName: string) => AppIdentity | null;
  readonly set: (pid: number, windowAppName: string, identity: AppIdentity) => void;
}

const MAX_ENTRIES = 512;

export function makeAppIdentities(): AppIdentities {
  const entries = new Map<string, AppIdentity>();
  const key = (pid: number, name: string) => `${pid}\u0000${name}`;
  return {
    get: (pid, name) => entries.get(key(pid, name)) ?? null,
    set: (pid, name, identity) => {
      if (entries.size >= MAX_ENTRIES) entries.clear();
      entries.set(key(pid, name), identity);
    },
  };
}
