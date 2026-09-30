import { describe, it, assert } from "@effect/vitest";
import { Effect, Random } from "effect";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter.ts";
import {
  makeMultiQueryHarness,
  THREAD_ID,
  makeDeterministicRandomService,
} from "./adapterTestFixtures";

describe("Claude cache preflight", () => {
  const nativeSessionId = "21d6c45d-b52f-4d3b-a7b1-dcb6bc8d8ba1";
  const resumedObservation = {
    nativeSessionId,
    lifecycleGeneration: "previous-generation",
    observedAt: "1970-01-01T00:00:00.000Z",
    lastResponseAt: "1970-01-01T00:00:00.000Z",
    contextTokens: 896542,
    ttlSeconds: 3600,
    state: "likely-warm" as const,
    source: "request-usage" as const,
  };

  it.effect("ignores a retired process's late hook and mismatched persisted identity", () => {
    const harness = makeMultiQueryHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        runtimeMode: "full-access",
        resumeCursor: { resume: nativeSessionId },
      });
      const oldHook = harness.createInputs[0]!.options.hooks!.SessionStart![0]!.hooks[0]!;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        runtimeMode: "full-access",
        resumeCursor: {
          resume: nativeSessionId,
          claudeCache: { ...resumedObservation, nativeSessionId: "another-session" },
        },
      });
      yield* Effect.promise(() =>
        oldHook(
          {
            hook_event_name: "SessionStart",
            session_id: nativeSessionId,
            source: "resume",
            context_tokens: 999999,
            prompt_cache_likely_expired: true,
            transcript_path: "/tmp/fixture.jsonl",
            cwd: "/tmp",
          },
          undefined,
          { signal: new AbortController().signal },
        ),
      );
      assert.isUndefined(yield* adapter.getClaudeCacheObservation!(THREAD_ID));
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });
});
