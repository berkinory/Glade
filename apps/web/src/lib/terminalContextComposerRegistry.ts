import type { TerminalContextSelection } from "./terminalContext";

export type TerminalContextComposerTarget = (selection: TerminalContextSelection) => void;

type RegistryListener = () => void;

let currentTarget: TerminalContextComposerTarget | undefined;
const listeners = new Set<RegistryListener>();

function notifyTargetChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function registerTerminalContextComposerTarget(
  target: TerminalContextComposerTarget,
): () => void {
  currentTarget = target;
  notifyTargetChanged();
  return () => {
    if (currentTarget !== target) {
      return;
    }
    currentTarget = undefined;
    notifyTargetChanged();
  };
}

export function getTerminalContextComposerTarget(): TerminalContextComposerTarget | undefined {
  return currentTarget;
}

export function subscribeTerminalContextComposerTarget(listener: RegistryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
