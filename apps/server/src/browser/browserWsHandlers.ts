import type { BrowserTabsChanged } from "@glade/contracts/browser/browserHost";
import {
  BROWSER_WS_METHODS,
  type BrowserPanelCommand,
  type BrowserTabsSubscribeInput,
} from "@glade/contracts/transport/ws/browserRpc";
import { WsRpcError } from "@glade/contracts/transport/ws/rpcErrors";
import { Effect, Option, Stream } from "effect";

import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { browserThreadWorkspace } from "./browserThreadWorkspace.ts";
import type { BrowserHostShape } from "./Services/BrowserHost.ts";

interface StreamAdmission {
  readonly guard: <A, E, R>(
    clientId: number,
    subscription: { readonly key: string },
    stream: Stream.Stream<A, E, R>,
  ) => Stream.Stream<A, E | WsRpcError, R>;
}

const unavailable = () =>
  new WsRpcError({
    message: "Glade's browser is only available in the Glade desktop app.",
    code: "unavailable",
  });

// The browser panel's live tab list and the commands the user gives from it. Every call is scoped
// to the thread in the payload; the desktop only resolves that thread's tabs.
export function makeBrowserWsHandlers(input: {
  readonly host: Option.Option<BrowserHostShape>;
  readonly snapshots: ProjectionSnapshotQueryShape;
  readonly streamAdmission: StreamAdmission;
}) {
  const run = (command: BrowserPanelCommand) =>
    Effect.gen(function* () {
      if (Option.isNone(input.host)) return yield* unavailable();
      const host = input.host.value;
      const workspaceDir = yield* browserThreadWorkspace(input.snapshots, command.threadId);
      const scope = { threadId: command.threadId, workspaceDir, actor: "user" as const };
      const { action } = command;
      const call =
        command.action === "contentBlocker"
          ? host.call("browser.contentBlocker", {
              ...scope,
              tabId: command.tabId,
              enabled: command.enabled,
            })
          : command.action === "dialog"
            ? host.call("browser.dialog", {
                ...scope,
                tabId: command.tabId,
                accept: command.accept,
              })
            : command.action === "navigate"
              ? host.call("browser.navigate", {
                  ...scope,
                  tabId: command.tabId,
                  ...(command.url !== undefined ? { url: command.url } : {}),
                  ...(command.history !== undefined ? { history: command.history } : {}),
                })
              : host.call("browser.tabs", {
                  ...scope,
                  action,
                  ...("tabId" in command ? { tabId: command.tabId } : {}),
                  ...("url" in command && command.url !== undefined ? { url: command.url } : {}),
                });
      yield* call.pipe(
        Effect.mapError((error) => new WsRpcError({ message: error.message, code: error.code })),
      );
    });

  return {
    [BROWSER_WS_METHODS.subscribeTabs]: (
      payload: BrowserTabsSubscribeInput,
      options: { readonly clientId: number },
    ): Stream.Stream<BrowserTabsChanged, WsRpcError> =>
      Option.isNone(input.host)
        ? Stream.fail(unavailable())
        : input.streamAdmission.guard(
            options.clientId,
            { key: `browser.tabs:${payload.threadId}` },
            input.host.value.threadTabs(payload.threadId),
          ),
    [BROWSER_WS_METHODS.command]: (command: BrowserPanelCommand): Effect.Effect<void, WsRpcError> =>
      run(command),
  };
}
