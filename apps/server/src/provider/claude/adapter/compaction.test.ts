import { describe, it, assert } from "@effect/vitest";
import { Effect, Random } from "effect";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter";
import {
  makeHarness,
  THREAD_ID,
  makeDeterministicRandomService,
  readFirstPromptMessage,
} from "./adapterTestFixtures";

describe("native Claude compaction", () => {
  it.effect(
    "keeps the established model and permission profile when the composer requests another",
    () => {
      const harness = makeHarness();
      harness.query.supportedCommandList = [
        { name: "compact", description: "Compact", argumentHint: "" },
      ];
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "approval-required",
          modelSelection: { provider: "claudeAgent", model: "claude-sonnet-5" },
          resumeCursor: { resume: "550e8400-e29b-41d4-a716-446655440000" },
        });
        const modelsBefore = [...harness.query.setModelCalls];
        const flagsBefore = [...harness.query.applyFlagSettingsCalls];
        const permissionsBefore = [...harness.query.setPermissionModeCalls];
        yield* adapter.sendTurn({
          threadId: THREAD_ID,
          input: "/compact preserve decisions",
          attachments: [],
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-opus-4-6",
            options: { effort: "high", thinking: true },
          },
        });
        assert.deepEqual(harness.query.setModelCalls, modelsBefore);
        assert.deepEqual(harness.query.applyFlagSettingsCalls, flagsBefore);
        assert.deepEqual(harness.query.setPermissionModeCalls, permissionsBefore);
        const prompt = yield* Effect.promise(() =>
          readFirstPromptMessage(harness.getLastCreateQueryInput()),
        );
        assert.deepEqual(prompt?.message.content, [
          { type: "text", text: "/compact preserve decisions" },
        ]);
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );
});
