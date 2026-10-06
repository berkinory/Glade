import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import { registerTerminalRuntimeCleanup } from "../../lib/terminalStateCleanup";

import {
  attachRuntimeToContainer,
  createRuntimeEntry,
  detachRuntimeFromContainer,
  disposeRuntimeEntry,
  syncRuntimeConfig,
  updateRuntimeViewState,
} from "./terminalRuntime";
import type {
  TerminalRuntimeConfig,
  TerminalRuntimeEntry,
  TerminalRuntimeStatus,
  TerminalRuntimeViewState,
} from "./terminalRuntimeTypes";
import { buildTerminalRuntimeKey } from "./terminalRuntimeTypes";

class TerminalRuntimeRegistry {
  private entries = new Map<string, TerminalRuntimeEntry>();

  attach(
    config: TerminalRuntimeConfig,
    viewState: TerminalRuntimeViewState,
    container: HTMLDivElement,
  ): { terminal: Terminal; searchAddon: SearchAddon; runtimeStatus: TerminalRuntimeStatus } {
    let entry = this.entries.get(config.runtimeKey);
    if (!entry) {
      entry = createRuntimeEntry(config);
      this.entries.set(config.runtimeKey, entry);
    } else {
      syncRuntimeConfig(entry, config);
    }

    attachRuntimeToContainer(entry, viewState, container);
    return {
      terminal: entry.terminal,
      searchAddon: entry.searchAddon,
      runtimeStatus: entry.runtimeStatus,
    };
  }

  syncConfig(runtimeKey: string, config: TerminalRuntimeConfig): void {
    const entry = this.entries.get(runtimeKey);
    if (!entry) return;
    syncRuntimeConfig(entry, config);
  }

  setViewState(runtimeKey: string, viewState: TerminalRuntimeViewState): void {
    const entry = this.entries.get(runtimeKey);
    if (!entry) return;
    updateRuntimeViewState(entry, viewState);
  }

  detach(runtimeKey: string): void {
    const entry = this.entries.get(runtimeKey);
    if (!entry) return;
    detachRuntimeFromContainer(entry);
  }

  dispose(runtimeKey: string): void {
    const entry = this.entries.get(runtimeKey);
    if (!entry) return;
    disposeRuntimeEntry(entry);
    this.entries.delete(runtimeKey);
  }

  disposeTerminal(threadId: string, terminalId: string): void {
    this.dispose(buildTerminalRuntimeKey(threadId, terminalId));
  }

  // Disposes the runtime only after `close` succeeds, and only if it is still the one that existed
  // when the close began; a runtime created meanwhile belongs to a reopened session.
  async disposeTerminalAfter(
    threadId: string,
    terminalId: string,
    close: () => Promise<void>,
  ): Promise<void> {
    const runtimeKey = buildTerminalRuntimeKey(threadId, terminalId);
    const entry = this.entries.get(runtimeKey);
    await close();
    if (entry && this.entries.get(runtimeKey) === entry) this.dispose(runtimeKey);
  }

  disposeThread(threadId: string): void {
    for (const [runtimeKey, entry] of this.entries) {
      if (entry.threadId === threadId) {
        this.dispose(runtimeKey);
      }
    }
  }

  disposeOrphanedThreads(activeThreadIds: ReadonlySet<string>): void {
    for (const [runtimeKey, entry] of this.entries) {
      if (!activeThreadIds.has(entry.threadId)) {
        this.dispose(runtimeKey);
      }
    }
  }

  focus(runtimeKey: string): void {
    this.entries.get(runtimeKey)?.terminal.focus();
  }
}

export const terminalRuntimeRegistry = new TerminalRuntimeRegistry();
registerTerminalRuntimeCleanup((activeThreadIds) =>
  terminalRuntimeRegistry.disposeOrphanedThreads(activeThreadIds),
);
