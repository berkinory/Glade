import { useSyncExternalStore } from "react";
import { isElectron } from "../env";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "./environmentKey";

// The environment of the chat on screen, or local when no chat is open. Calls that name no thread,
// project or path go to it, and features that act on this machine (folder pickers, Finder, dropped
// file paths, the agent browser, computer use) only apply while it is local.
let active: EnvironmentKey = LOCAL_ENVIRONMENT;
const listeners = new Set<() => void>();

export function activeEnvironment(): EnvironmentKey {
  return active;
}

export function setActiveEnvironment(key: EnvironmentKey): void {
  if (key === active) return;
  active = key;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActiveEnvironment(): EnvironmentKey {
  return useSyncExternalStore(subscribe, activeEnvironment);
}

export function isLocalDesktopActive(): boolean {
  return isElectron && active === LOCAL_ENVIRONMENT;
}

export function useLocalDesktopActive(): boolean {
  return isElectron && useActiveEnvironment() === LOCAL_ENVIRONMENT;
}
