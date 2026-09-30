import type { TerminalSessionSnapshot } from "@glade/contracts/terminal/terminal";
import { defaultTerminalTitleForCliKind } from "@glade/shared/threads/terminalThreads";
import { writeSystemMessage } from "./terminalRuntimeAppearance";
import { terminalEventDispatcher } from "./terminalEventDispatcher";
import type { TerminalRuntimeEntry } from "./terminalRuntimeTypes";

type TerminalEventOperations = {
  setStatus: (entry: TerminalRuntimeEntry, status: TerminalRuntimeEntry["runtimeStatus"]) => void;
  scheduleWrite: (entry: TerminalRuntimeEntry, data: string, byteLength: number) => void;
  byteLength: (data: string) => number;
  hasReplayPayload: (snapshot: TerminalSessionSnapshot) => boolean;
  replaySnapshot: (
    entry: TerminalRuntimeEntry,
    snapshot: TerminalSessionSnapshot,
    onComplete: () => void,
  ) => void;
  clearPendingWrites: (entry: TerminalRuntimeEntry) => void;
  flushPendingWrites: (entry: TerminalRuntimeEntry) => void;
};

export function registerTerminalEventHandler(
  entry: TerminalRuntimeEntry,
  operations: TerminalEventOperations,
): void {
  const terminal = entry.terminal;
  entry.unsubscribeTerminalEvents = terminalEventDispatcher.subscribe(
    entry.threadId,
    entry.terminalId,
    (event) => {
      if (event.type === "output") {
        operations.setStatus(entry, "ready");
        entry.outputEventVersion += 1;
        operations.scheduleWrite(
          entry,
          event.data,
          event.byteLength ?? operations.byteLength(event.data),
        );
        return;
      }

      if (event.type === "started" || event.type === "restarted") {
        entry.hasHandledExit = false;
        const shouldReplaySnapshot =
          event.type === "restarted" || operations.hasReplayPayload(event.snapshot);
        if (shouldReplaySnapshot) {
          operations.replaySnapshot(entry, event.snapshot, () =>
            operations.setStatus(entry, "ready"),
          );
        } else {
          operations.setStatus(entry, "ready");
        }
        return;
      }

      if (event.type === "cleared") {
        entry.titleInputBuffer = "";
        entry.linkMatchCache.clear();
        operations.clearPendingWrites(entry);
        terminal.clear();
        terminal.write("\u001bc");
        return;
      }

      if (event.type === "activity") {
        if (entry.terminalCliKind !== event.cliKind) {
          entry.terminalCliKind = event.cliKind;
          entry.callbacks.onTerminalMetadataChange(entry.terminalId, {
            cliKind: event.cliKind,
            label: event.cliKind ? defaultTerminalTitleForCliKind(event.cliKind) : "Terminal",
          });
        }
        entry.callbacks.onTerminalActivityChange(entry.terminalId, {
          hasRunningSubprocess: event.hasRunningSubprocess,
          agentState: event.agentState,
        });
        return;
      }

      if (event.type === "error") {
        operations.setStatus(entry, "error");
        writeSystemMessage(terminal, event.message);
        return;
      }

      if (event.type === "exited") {
        operations.flushPendingWrites(entry);
        operations.setStatus(entry, "exited");
        entry.callbacks.onTerminalActivityChange(entry.terminalId, {
          hasRunningSubprocess: false,
          agentState: null,
        });
        const details = [
          typeof event.exitCode === "number" ? `code ${event.exitCode}` : null,
          typeof event.exitSignal === "number" ? `signal ${event.exitSignal}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join(", ");
        writeSystemMessage(
          terminal,
          details.length > 0 ? `Process exited (${details})` : "Process exited",
        );
        if (entry.hasHandledExit) {
          return;
        }
        entry.hasHandledExit = true;
        window.setTimeout(() => {
          if (!entry.hasHandledExit) {
            return;
          }
          entry.callbacks.onSessionExited();
        }, 0);
      }
    },
  );
}
