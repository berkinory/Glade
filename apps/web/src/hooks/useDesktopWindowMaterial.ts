import type { DesktopWindowMaterialState } from "@glade/contracts/ipc/ipc";
import { useSyncExternalStore } from "react";

let state: DesktopWindowMaterialState = { supported: false, enabled: false };
let error: string | null = null;
const listeners = new Set<() => void>();

function publish(next: DesktopWindowMaterialState): void {
  state = next;
  document.documentElement.toggleAttribute("data-window-material", next.enabled);
  for (const listener of listeners) listener();
}

export function initializeDesktopWindowMaterial(): void {
  const bridge = window.desktopBridge?.windowMaterial;
  if (!bridge) return;
  void bridge
    .getState()
    .then(publish)
    .catch((cause: unknown) => {
      error = cause instanceof Error ? cause.message : String(cause);
      for (const listener of listeners) listener();
    });
}

async function setEnabled(enabled: boolean): Promise<void> {
  const bridge = window.desktopBridge?.windowMaterial;
  if (!bridge) throw new Error("Native window material is unavailable.");
  publish(await bridge.setEnabled(enabled));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDesktopWindowMaterial() {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useSyncExternalStore(subscribe, () => error);
  return { ...snapshot, error, setEnabled };
}
