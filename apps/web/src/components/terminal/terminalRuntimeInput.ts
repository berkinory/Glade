import { consumeTerminalIdentityInput } from "@glade/shared/threads/terminalThreads";
import { describeErrorMessage } from "@glade/shared/text/errorMessages";
import { readNativeApi } from "~/nativeApi";
import { openInPreferredEditor } from "../../editorPreferences";
import { isTerminalClearShortcut, terminalNavigationShortcutData } from "../../keybindings";
import {
  collectWrappedTerminalLinkLine,
  isTerminalLinkActivation,
  resolvePathLinkTarget,
  resolveWrappedTerminalLinkRange,
  wrappedTerminalLinkRangeIntersectsBufferLine,
} from "../../terminal-links";
import { writeSystemMessage } from "./terminalRuntimeAppearance";
import type { TerminalRuntimeEntry } from "./terminalRuntimeTypes";

export function registerTerminalInputHandlers(
  entry: TerminalRuntimeEntry,
  sendTerminalInput: (
    entry: TerminalRuntimeEntry,
    data: string,
    errorMessage: string,
  ) => Promise<void>,
  readCachedTerminalLinks: (
    entry: TerminalRuntimeEntry,
    line: string,
  ) => ReturnType<typeof import("../../terminal-links").extractTerminalLinks>,
): void {
  const terminal = entry.terminal;
  terminal.attachCustomKeyEventHandler((event) => {
    if (
      event.type === "keydown" &&
      event.key === "Enter" &&
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      void sendTerminalInput(entry, "\n", "Failed to insert newline");
      return false;
    }

    if (
      event.type === "keydown" &&
      event.key.toLowerCase() === "f" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      return true;
    }

    const navigationData = terminalNavigationShortcutData(event);
    if (navigationData !== null) {
      event.preventDefault();
      event.stopPropagation();
      void sendTerminalInput(entry, navigationData, "Failed to move cursor");
      return false;
    }

    if (!isTerminalClearShortcut(event)) return true;
    event.preventDefault();
    event.stopPropagation();
    void sendTerminalInput(entry, "\u000c", "Failed to clear terminal");
    return false;
  });

  entry.terminalDisposables.push(
    terminal.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const wrappedLine = collectWrappedTerminalLinkLine(bufferLineNumber, (bufferLineIndex) =>
          terminal.buffer.active.getLine(bufferLineIndex),
        );
        if (!wrappedLine) {
          callback(undefined);
          return;
        }

        const links = readCachedTerminalLinks(entry, wrappedLine.text)
          .map((match) => ({
            match,
            range: resolveWrappedTerminalLinkRange(wrappedLine, match),
          }))
          .filter(({ range }) =>
            wrappedTerminalLinkRangeIntersectsBufferLine(range, bufferLineNumber),
          );
        if (links.length === 0) {
          callback(undefined);
          return;
        }

        callback(
          links.map(({ match, range }) => ({
            text: match.text,
            range,
            activate: (event: MouseEvent) => {
              if (!isTerminalLinkActivation(event)) return;
              const api = readNativeApi();
              if (!api) return;

              if (match.kind === "url") {
                void api.shell.openExternal(match.text).catch((error) => {
                  writeSystemMessage(terminal, describeErrorMessage(error, "Unable to open link"));
                });
                return;
              }

              const target = resolvePathLinkTarget(match.text, entry.cwd);
              void openInPreferredEditor(api, target).catch((error) => {
                writeSystemMessage(terminal, describeErrorMessage(error, "Unable to open path"));
              });
            },
          })),
        );
      },
    }),
  );

  entry.terminalDisposables.push(
    terminal.onData((data) => {
      const nextIdentityState = consumeTerminalIdentityInput(entry.titleInputBuffer, data);
      entry.titleInputBuffer = nextIdentityState.buffer;
      const submittedIdentity = nextIdentityState.identity;
      if (submittedIdentity && (submittedIdentity.cliKind || entry.terminalCliKind !== null)) {
        entry.terminalCliKind = submittedIdentity.cliKind;
        entry.callbacks.onTerminalMetadataChange(entry.terminalId, {
          cliKind: submittedIdentity.cliKind,
          label: submittedIdentity.title,
        });
      }
      const api = readNativeApi();
      if (!api) return;
      void api.terminal
        .write({ threadId: entry.threadId, terminalId: entry.terminalId, data })
        .catch((error) =>
          writeSystemMessage(terminal, describeErrorMessage(error, "Terminal write failed")),
        );
    }),
  );
}
