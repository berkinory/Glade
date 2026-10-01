import { Effect, Option } from "effect";
import { ProviderService } from "../Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { assert } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";
import { ProviderValidationError } from "../core/Errors.ts";
import { ProviderSessionRuntimeRepository } from "../../persistence/Services/ProviderSessionRuntime.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderSendTurnInput } from "@glade/contracts/provider/provider";
import {
  routing,
  asThreadId,
  asRequestId,
  asTurnId,
  asRuntimePayloadRecord,
  asEventId,
  sleep,
  makeProviderServiceLayer,
} from "./providerServiceTestFixtures";

routing.layer("Provider service sessionOperations", (it) => {
  it.effect("requires the source lifecycle generation for modern Claude interactions", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-claude-interaction-generation");

      yield* provider.startSession(threadId, {
        provider: "claudeAgent",
        threadId,
        cwd: "/tmp/project",
        runtimeMode: "approval-required",
      });
      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      const lifecycleGeneration = binding?.lifecycleGeneration;
      assert.equal(typeof lifecycleGeneration, "string");

      const approvalCallCount = routing.claude.respondToRequest.mock.calls.length;
      const missingApprovalGeneration = yield* Effect.result(
        provider.respondToRequest({
          threadId,
          requestId: asRequestId("claude-approval-without-generation"),
          decision: "accept",
        }),
      );
      assertFailure(
        missingApprovalGeneration,
        new ProviderValidationError({
          operation: "ProviderService.respondToRequest",
          issue:
            "Cannot respond to request 'claude-approval-without-generation' without its provider lifecycle generation.",
        }),
      );
      assert.equal(routing.claude.respondToRequest.mock.calls.length, approvalCallCount);

      const userInputCallCount = routing.claude.respondToUserInput.mock.calls.length;
      const missingUserInputGeneration = yield* Effect.result(
        provider.respondToUserInput({
          threadId,
          requestId: asRequestId("claude-user-input-without-generation"),
          answers: { answer: "continue" },
        }),
      );
      assertFailure(
        missingUserInputGeneration,
        new ProviderValidationError({
          operation: "ProviderService.respondToUserInput",
          issue:
            "Cannot respond to request 'claude-user-input-without-generation' without its provider lifecycle generation.",
        }),
      );
      assert.equal(routing.claude.respondToUserInput.mock.calls.length, userInputCallCount);

      yield* provider.respondToRequest({
        threadId,
        requestId: asRequestId("claude-approval-current-generation"),
        lifecycleGeneration,
        decision: "accept",
      });
      yield* provider.respondToUserInput({
        threadId,
        requestId: asRequestId("claude-user-input-current-generation"),
        lifecycleGeneration,
        answers: { answer: "continue" },
      });
      assert.equal(routing.claude.respondToRequest.mock.calls.length, approvalCallCount + 1);
      assert.equal(routing.claude.respondToUserInput.mock.calls.length, userInputCallCount + 1);
      yield* provider.stopSession({ threadId });
      routing.claude.startSession.mockClear();
      routing.claude.respondToRequest.mockClear();
      routing.claude.respondToUserInput.mockClear();
      routing.claude.stopSession.mockClear();
    }),
  );

  it.effect("routes provider operations and rollback conversation", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      routing.codex.sendTurn.mockClear();
      routing.codex.interruptTurn.mockClear();
      routing.codex.startSession.mockClear();
      routing.codex.stopSession.mockClear();
      routing.codex.respondToRequest.mockClear();
      routing.codex.respondToUserInput.mockClear();

      const session = yield* provider.startSession(asThreadId("thread-1"), {
        provider: "codex",
        threadId: asThreadId("thread-1"),
        cwd: "/tmp/project",
        runtimeMode: "full-access",
      });
      assert.equal(session.provider, "codex");
      const binding = Option.getOrUndefined(yield* directory.getBinding(session.threadId));
      const lifecycleGeneration = binding?.lifecycleGeneration;
      assert.equal(typeof lifecycleGeneration, "string");

      const sessions = yield* provider.listSessions();
      assert.equal(sessions.length, 1);

      yield* provider.respondToRequest({
        threadId: session.threadId,
        requestId: asRequestId("req-1"),
        lifecycleGeneration,
        decision: "accept",
      });
      assert.deepEqual(routing.codex.respondToRequest.mock.calls, [
        [session.threadId, asRequestId("req-1"), "accept"],
      ]);

      yield* provider.respondToUserInput({
        threadId: session.threadId,
        requestId: asRequestId("req-user-input-1"),
        lifecycleGeneration,
        answers: {
          sandbox_mode: "workspace-write",
        },
      });
      assert.deepEqual(routing.codex.respondToUserInput.mock.calls, [
        [
          session.threadId,
          asRequestId("req-user-input-1"),
          {
            sandbox_mode: "workspace-write",
          },
        ],
      ]);

      yield* provider.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });
      assert.equal(routing.codex.sendTurn.mock.calls.length, 1);

      yield* provider.interruptTurn({ threadId: session.threadId });
      assert.deepEqual(routing.codex.interruptTurn.mock.calls, [
        [session.threadId, asTurnId("turn-thread-1"), undefined],
      ]);
      assert.deepEqual(routing.codex.stopSession.mock.calls, [[session.threadId]]);
      const fencedBinding = Option.getOrUndefined(yield* directory.getBinding(session.threadId));
      assert.equal(fencedBinding?.status, "stopped");
      assert.equal(
        asRuntimePayloadRecord(fencedBinding?.runtimePayload)
          .agentGatewayCredentialRotationRequired,
        true,
      );

      const startsBeforeRecovery = routing.codex.startSession.mock.calls.length;
      yield* provider.sendTurn({
        threadId: session.threadId,
        input: "continue after interrupt",
        attachments: [],
      });
      assert.equal(routing.codex.startSession.mock.calls.length, startsBeforeRecovery + 1);
      const resumedInput = routing.codex.startSession.mock.calls.at(-1)?.[0];
      assert.deepEqual(resumedInput?.resumeCursor, session.resumeCursor);
      const recoveredBinding = Option.getOrUndefined(yield* directory.getBinding(session.threadId));
      assert.equal(
        asRuntimePayloadRecord(recoveredBinding?.runtimePayload)
          .agentGatewayCredentialRotationRequired,
        false,
      );

      yield* provider.rollbackConversation({
        threadId: session.threadId,
        numTurns: 0,
      });

      yield* provider.stopSession({ threadId: session.threadId });
      const sendAfterStop = yield* Effect.result(
        provider.sendTurn({
          threadId: session.threadId,
          input: "after-stop",
          attachments: [],
        }),
      );
      assertFailure(
        sendAfterStop,
        new ProviderValidationError({
          operation: "ProviderService.sendTurn",
          issue: `Cannot route thread '${session.threadId}' because no persisted provider binding exists.`,
          reason: "runtime-unavailable",
        }),
      );
    }),
  );

  it.effect(
    "routes early approval and user-input responses to live sessions before persistence",
    () =>
      Effect.gen(function* () {
        const provider = yield* ProviderService;
        const directory = yield* ProviderSessionDirectory;
        const threadId = asThreadId("thread-live-startup-prompt");

        routing.codex.respondToRequest.mockClear();
        routing.codex.respondToUserInput.mockClear();
        yield* routing.codex.adapter.startSession({
          provider: "codex",
          threadId,
          runtimeMode: "approval-required",
        });

        const bindingBeforeResponse = yield* directory.getBinding(threadId);
        assert.equal(Option.isNone(bindingBeforeResponse), true);

        yield* provider.respondToRequest({
          threadId,
          requestId: asRequestId("req-live-approval"),
          decision: "accept",
        });
        yield* provider.respondToUserInput({
          threadId,
          requestId: asRequestId("req-live-user-input"),
          answers: {
            answer: "continue",
          },
        });

        assert.deepEqual(routing.codex.respondToRequest.mock.calls, [
          [threadId, asRequestId("req-live-approval"), "accept"],
        ]);
        assert.deepEqual(routing.codex.respondToUserInput.mock.calls, [
          [
            threadId,
            asRequestId("req-live-user-input"),
            {
              answer: "continue",
            },
          ],
        ]);
      }),
  );

  it.effect("recovers stale claudeAgent sessions for sendTurn using persisted cwd", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;

      const initial = yield* provider.startSession(asThreadId("thread-claude-send-turn"), {
        provider: "claudeAgent",
        threadId: asThreadId("thread-claude-send-turn"),
        cwd: "/tmp/project-claude-send-turn",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
          options: {
            effort: "max",
          },
        },
        runtimeMode: "full-access",
      });

      yield* routing.claude.stopAll();
      routing.claude.startSession.mockClear();
      routing.claude.sendTurn.mockClear();

      yield* provider.sendTurn({
        threadId: initial.threadId,
        input: "resume with claude",
        attachments: [],
      });

      assert.equal(routing.claude.startSession.mock.calls.length, 1);
      const resumedStartInput = routing.claude.startSession.mock.calls[0]?.[0];
      assert.equal(typeof resumedStartInput === "object" && resumedStartInput !== null, true);
      if (resumedStartInput && typeof resumedStartInput === "object") {
        const startPayload = resumedStartInput as {
          provider?: string;
          cwd?: string;
          modelSelection?: unknown;
          resumeCursor?: unknown;
          threadId?: string;
        };
        assert.equal(startPayload.provider, "claudeAgent");
        assert.equal(startPayload.cwd, "/tmp/project-claude-send-turn");
        assert.deepEqual(startPayload.modelSelection, {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
          options: {
            effort: "max",
          },
        });
        assert.deepEqual(startPayload.resumeCursor, initial.resumeCursor);
        assert.equal(startPayload.threadId, initial.threadId);
      }
      assert.equal(routing.claude.sendTurn.mock.calls.length, 1);
    }),
  );

  it.effect("refreshes persisted resume cursor immediately on model reroutes", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const runtimeRepository = yield* ProviderSessionRuntimeRepository;
      yield* routing.claude.waitForRuntimeSubscribers();

      const session = yield* provider.startSession(asThreadId("thread-runtime-resume-refresh"), {
        provider: "claudeAgent",
        threadId: asThreadId("thread-runtime-resume-refresh"),
        runtimeMode: "full-access",
      });
      const updatedResumeCursor = {
        threadId: session.threadId,
        resume: "550e8400-e29b-41d4-a716-446655440000",
        resumeSessionAt: "assistant-message-refresh",
        turnCount: 2,
        rerouteOriginalApiModelId: "claude-fable-5",
        rerouteFallbackApiModelId: "claude-opus-4-8",
      };

      routing.claude.updateSession(session.threadId, (existing) => ({
        ...existing,
        resumeCursor: updatedResumeCursor,
      }));
      routing.claude.emit({
        type: "model.rerouted",
        eventId: asEventId("runtime-model-rerouted-refresh"),
        provider: "claudeAgent",
        createdAt: "2026-02-27T00:04:00.000Z",
        threadId: session.threadId,
        payload: {
          fromModel: "claude-fable-5",
          toModel: "claude-opus-4-8",
          reason: "Model safeguards rerouted this request.",
        },
      });
      yield* sleep(50);

      const runtime = yield* runtimeRepository.getByThreadId({
        threadId: session.threadId,
      });
      assert.equal(Option.isSome(runtime), true);
      if (Option.isSome(runtime)) {
        assert.deepEqual(runtime.value.resumeCursor, updatedResumeCursor);
      }
    }),
  );
});

const liveFallback = makeProviderServiceLayer();

liveFallback.layer("ProviderServiceLive live-fallback settled turns", (it) => {
  it.effect("persists the first binding row as stopped when the turn settles pre-write", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-live-fallback-settled");
      const turnId = asTurnId("turn-live-fallback-settled");

      liveFallback.codex.hasSession.mockImplementation((candidate: ThreadId) =>
        Effect.succeed(candidate === threadId),
      );
      liveFallback.codex.sendTurn.mockImplementationOnce((input: ProviderSendTurnInput) =>
        Effect.gen(function* () {
          liveFallback.codex.emit({
            type: "turn.completed",
            eventId: asEventId("evt-live-fallback-settled"),
            provider: "codex",
            createdAt: new Date().toISOString(),
            threadId: input.threadId,
            turnId,
            payload: { state: "cancelled" },
          });
          yield* sleep(100);
          return { threadId: input.threadId, turnId };
        }),
      );
      yield* liveFallback.codex.waitForRuntimeSubscribers();

      yield* provider.sendTurn({ threadId, input: "hello" });

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      assert.equal(binding?.status, "stopped");
    }),
  );
});
