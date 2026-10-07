import {
  BROWSER_FAILURE_CODES,
  BrowserHostResult,
  type BrowserFailureCode,
  type BrowserHostMethod,
} from "@glade/contracts/browser/browserHost";
import { Effect, Layer, Schema } from "effect";

import { DesktopHostClient } from "../../desktopHost/Services/DesktopHostClient.ts";
import { BrowserHost, BrowserHostError, type BrowserHostShape } from "../Services/BrowserHost.ts";

// Navigation waits up to 30 s on the desktop; uploads may click and wait for a chooser.
const TIMEOUT_MS: Partial<Record<BrowserHostMethod, number>> = {
  "browser.tabs": 40_000,
  "browser.navigate": 40_000,
  "browser.click": 20_000,
  "browser.press": 20_000,
  "browser.type": 20_000,
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
    return { available: desktopHost.configured, call } satisfies BrowserHostShape;
  }),
);
