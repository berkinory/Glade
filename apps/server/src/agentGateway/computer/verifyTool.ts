import { Effect, Option, Schema } from "effect";

import { CuaVerifyResult, resultText } from "../../computer/cuaResults.ts";
import type { ToolEntry } from "../toolRuntime.ts";
import {
  appContent,
  callCua,
  computerTool,
  imageContent,
  windowFor,
  type ComputerToolServices,
} from "./computerCalls.ts";

const MAX_TIMEOUT_MS = 10_000;

const Condition = Schema.Struct({
  role: Schema.optional(
    Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'e.g. "AXButton".' }),
  ),
  label_contains: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  value_equals: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  selected: Schema.optional(Schema.Boolean),
}).annotate({
  description:
    "An element matching role and/or label_contains exists, with the given value and state when set. Absence cannot be proven, so there is no exists:false.",
});

const VerifyInput = Schema.Struct({
  pid: Schema.Int.annotate({ description: "Process id from computer_apps." }),
  window_id: Schema.Int.annotate({ description: "Window id from computer_apps." }),
  conditions: Schema.Array(Condition).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  timeout_ms: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_TIMEOUT_MS })).annotate({
      description: "How long to wait for all conditions (default 5000); 0 checks once.",
    }),
  ),
  stable_samples: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 })).annotate({
      description: "Consecutive satisfied samples required (default 2).",
    }),
  ),
  include_screenshot: Schema.optional(Schema.Boolean),
});

// Cua's verify_state: waits, bounded, until every condition holds in the window's tree.
export const makeVerifyTool = (services: ComputerToolServices): ToolEntry =>
  computerTool(services, {
    name: "computer_verify",
    title: "Wait for a window state",
    description: `Wait up to ${MAX_TIMEOUT_MS / 1000} s until every condition holds in one window's accessibility tree (an element exists, has a value, is enabled or selected), e.g. after an action whose effect was unverifiable or while an app loads. Returns satisfied, unsatisfied or unknown per condition; unknown never means success. Needs read access.`,
    input: VerifyInput,
    readOnly: true,
    run: (input, context) =>
      Effect.gen(function* () {
        const window = yield* windowFor(services, context, input, {
          scope: "read",
          action: "read",
        });
        const result = yield* callCua(
          services,
          context,
          "verify_state",
          {
            pid: input.pid,
            window_id: input.window_id,
            expect: input.conditions.map(({ role, label_contains, ...state }) => ({
              element: {
                selector: {
                  ...(role ? { role } : {}),
                  ...(label_contains ? { label_contains } : {}),
                },
                exists: true,
                ...state,
              },
            })),
            timeout_ms: input.timeout_ms ?? 5_000,
            ...(input.stable_samples ? { stable_samples: input.stable_samples } : {}),
            include_screenshot: input.include_screenshot === true,
          },
          MAX_TIMEOUT_MS + 5_000,
        );
        const verified = Schema.decodeUnknownOption(CuaVerifyResult)(result.structuredContent);
        const text = Option.match(verified, {
          onNone: () => resultText(result) || "verify_state returned no result.",
          onSome: (value) =>
            [
              `Status: ${value.status}${value.stable ? ", stable" : ""} after ${value.elapsed_ms} ms (${value.samples} samples).`,
              appContent(
                window,
                value.predicates
                  .map(
                    (predicate) =>
                      `condition ${predicate.index}: ${predicate.status}${predicate.unknown_reason ? ` (${predicate.unknown_reason})` : ""}${predicate.observed_json ? ` observed ${predicate.observed_json}` : ""}`,
                  )
                  .join("\n"),
              ),
            ].join("\n"),
        });
        const image = input.include_screenshot
          ? yield* imageContent(services, context, result)
          : [];
        return { content: [{ type: "text", text }, ...image] };
      }),
  });
