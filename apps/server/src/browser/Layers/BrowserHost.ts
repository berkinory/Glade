import {
  BROWSER_FAILURE_CODES,
  BROWSER_TABS_CHANGED_NOTIFICATION,
  BrowserHostResult,
  BrowserTabsChanged,
  type BrowserFailureCode,
  type BrowserHostMethod,
} from "@glade/contracts/browser/browserHost";
import { Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect";

import { DesktopHostClient } from "../../desktopHost/Services/DesktopHostClient.ts";
import { BrowserHost, BrowserHostError, type BrowserHostShape } from "../Services/BrowserHost.ts";

// Navigation waits up to 30 s on the desktop; input actions up to 17 s (28 s for a fill) for
// what they cause.
const TIMEOUT_MS: Partial<Record<BrowserHostMethod, number>> = {
  "browser.tabs": 40_000,
  "browser.navigate": 40_000,
  "browser.click": 20_000,
  "browser.hover": 20_000,
  "browser.type": 20_000,
  "browser.press": 20_000,
  "browser.select": 20_000,
  "browser.scroll": 20_000,
  "browser.upload": 20_000,
  "browser.fill": 32_000,
};
const DEFAULT_TIMEOUT_MS = 15_000;

const failureCode = (code: string): BrowserFailureCode =>
  (BROWSER_FAILURE_CODES as readonly string[]).includes(code)
    ? (code as BrowserFailureCode)
    : "unavailable";

export const BrowserHostLive = Layer.effect(
  BrowserHost,
  Effect.gen(function* () {
    const desktopHost = yield* DesktopHostClient;
    const decodeResult = Schema.decodeUnknownEffect(BrowserHostResult);
    const call: BrowserHostShape["call"] = (method, params) =>
      desktopHost.request(method, params, TIMEOUT_MS[method] ?? DEFAULT_TIMEOUT_MS).pipe(
        Effect.mapError(
          (error) =>
            new BrowserHostError({ code: failureCode(error.code), message: error.message }),
        ),
        Effect.flatMap((result) =>
          decodeResult(result).pipe(
            Effect.mapError(
              () =>
                new BrowserHostError({
                  code: "unavailable",
                  message: `The desktop browser host returned an unexpected ${method} result.`,
                }),
            ),
          ),
        ),
      );

    // The desktop sends every tab of every thread on each change and again whenever this server
    // connects, so the latest notification is the whole truth.
    const decodeTabs = Schema.decodeUnknownOption(BrowserTabsChanged);
    const allTabs = yield* SubscriptionRef.make<BrowserTabsChanged["tabs"]>([]);
    yield* desktopHost.notifications.pipe(
      Stream.filter((notification) => notification.method === BROWSER_TABS_CHANGED_NOTIFICATION),
      Stream.runForEach((notification) =>
        Option.match(decodeTabs(notification.params), {
          onNone: () => Effect.logWarning("Ignored a malformed browser tab notification."),
          onSome: ({ tabs }) => SubscriptionRef.set(allTabs, tabs),
        }),
      ),
      Effect.forkScoped,
    );
    const threadTabs: BrowserHostShape["threadTabs"] = (threadId) =>
      SubscriptionRef.changes(allTabs).pipe(
        Stream.map((tabs) => tabs.filter((tab) => tab.threadId === threadId)),
        Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
        Stream.map((tabs) => ({ tabs })),
      );

    return { available: desktopHost.configured, call, threadTabs } satisfies BrowserHostShape;
  }),
);
