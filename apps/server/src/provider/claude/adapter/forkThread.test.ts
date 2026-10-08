import { describe, it, assert } from "@effect/vitest";
import { beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { type ClaudeAdapterLiveOptions } from "./adapterConfiguration.ts";
import { Effect, Random } from "effect";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter.ts";
import { ProviderAdapterValidationError, ProviderAdapterRequestError } from "../../core/Errors.ts";
import { Schema } from "effect";
import {
  makeClaudeAdapterTestLayer,
  THREAD_ID,
  RESUME_THREAD_ID,
  makeDeterministicRandomService,
  FakeClaudeQuery,
} from "./adapterTestFixtures";

describe("ClaudeAdapterLive forkThread", () => {
  let configDir: string;
  beforeEach(() => {
    configDir = mkdtempSync(path.join(os.tmpdir(), "claude-fork-config-"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(configDir, { recursive: true, force: true });
  });
  const SOURCE_SESSION_ID = "7f9c2f60-1111-4a2b-9c3d-8e5f6a7b8c9d";

  function makeForkLayer(
    forkNativeSession: NonNullable<ClaudeAdapterLiveOptions["forkNativeSession"]>,
  ) {
    return makeClaudeAdapterTestLayer({ forkNativeSession });
  }

  it.effect("forks at the selected native message instead of the later persisted cursor", () => {
    const forkCalls: Array<{
      readonly sessionId: string;
      readonly options: { readonly dir?: string; readonly upToMessageId?: string } | undefined;
    }> = [];
    const layer = makeForkLayer(async (sessionId, options) => {
      forkCalls.push({ sessionId, options });
      return { sessionId: "forked-session-1" };
    });

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const result = yield* adapter.forkThread!({
        sourceThreadId: THREAD_ID,
        forkPoint: { provider: "claudeAgent", messageId: "chosen-assistant-uuid-2" },
        threadId: RESUME_THREAD_ID,
        runtimeMode: "full-access",
        sourceCwd: "/repo/source",
        sourceResumeCursor: {
          threadId: String(THREAD_ID),
          resume: SOURCE_SESSION_ID,
          resumeSessionAt: "assistant-uuid-9",
          turnCount: 4,
        },
      });

      assert.deepEqual(forkCalls, [
        {
          sessionId: SOURCE_SESSION_ID,
          options: { dir: "/repo/source", upToMessageId: "chosen-assistant-uuid-2" },
        },
      ]);

      assert.deepEqual(result, {
        threadId: RESUME_THREAD_ID,
        resumeCursor: {
          threadId: RESUME_THREAD_ID,
          resume: "forked-session-1",
          turnCount: 4,
          processedTokenTotal: 0,
          tokenAccountingVersion: 1,
        },
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("refuses a native fork while the source turn is in flight", () => {
    const query = new FakeClaudeQuery();
    let forkCalls = 0;
    const layer = makeClaudeAdapterTestLayer({
      createQuery: () => query,
      forkNativeSession: async () => {
        forkCalls += 1;
        return { sessionId: "unexpected" };
      },
    });

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "Long-running work",
        attachments: [],
      });

      const result = yield* adapter.forkThread!({
        sourceThreadId: THREAD_ID,
        threadId: RESUME_THREAD_ID,
        runtimeMode: "full-access",
        sourceResumeCursor: {
          threadId: String(THREAD_ID),
          resume: SOURCE_SESSION_ID,
        },
      }).pipe(Effect.result);

      assert.equal(forkCalls, 0);
      assert.equal(result._tag, "Failure");
      if (result._tag !== "Failure") {
        return;
      }
      assert.instanceOf(result.failure, ProviderAdapterValidationError);
      if (Schema.is(ProviderAdapterValidationError)(result.failure)) {
        assert.include(result.failure.issue, "turn in flight");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("maps a native fork failure to a session/fork request error", () => {
    const layer = makeForkLayer(async () => {
      throw new Error("session file missing");
    });

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const result = yield* adapter.forkThread!({
        sourceThreadId: THREAD_ID,
        threadId: RESUME_THREAD_ID,
        runtimeMode: "full-access",
        sourceResumeCursor: {
          threadId: String(THREAD_ID),
          resume: SOURCE_SESSION_ID,
        },
      }).pipe(Effect.result);

      assert.equal(result._tag, "Failure");
      if (result._tag !== "Failure") {
        return;
      }
      assert.instanceOf(result.failure, ProviderAdapterRequestError);
      if (Schema.is(ProviderAdapterRequestError)(result.failure)) {
        assert.equal(result.failure.method, "session/fork");
        assert.include(result.failure.detail, "session file missing");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });
});
