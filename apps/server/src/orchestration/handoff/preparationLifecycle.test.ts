import { ProviderSessionDirectory } from "../../provider/Services/ProviderSessionDirectory";
import { ProviderSessionDirectoryLive } from "../../provider/Layers/ProviderSessionDirectory";
import { ProviderSessionRuntimeRepositoryLive } from "../../persistence/Layers/ProviderSessionRuntime";
import { HandoffTransitions } from "../Services/HandoffTransitions";
import { readHandoffEvidenceSnapshot } from "./sourceSnapshot";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore";
import { HandoffTransitionsLive } from "../Layers/HandoffTransitions";
import { seedUserMessage } from "../persistedMessage.testSupport";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, MessageId, ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { HandoffRecord } from "@glade/contracts/orchestration/threadEntities";
import { Deferred, Effect, Fiber, Layer, ManagedRuntime, Option } from "effect";
import { describe, expect, it } from "vitest";
import { OrchestrationLayerLive } from "../runtimeLayer";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite";
import { ServerConfig } from "../../server/config";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery";
import { HandoffPreparation } from "../Services/HandoffPreparation";
import { HandoffPreparationLive } from "../Layers/HandoffPreparation";
import { HandoffGeneration } from "../../provider/Services/HandoffGeneration";
import { ProviderDiscoveryService } from "../../provider/Services/ProviderDiscoveryService";
import { ProviderValidationError } from "../../provider/core/Errors";
import { ServerSettingsService } from "../../settings/serverSettings";

const threadId = ThreadId.makeUnsafe("source");
const record: HandoffRecord = {
  objective: { text: "Preserve the database.", state: "fact", sourceRefs: ["message:original"] },
  scopeChanges: [],
  constraints: [],
  decisions: [],
  completedWork: [],
  files: [],
  repositoryState: [],
  verification: [],
  unresolved: [],
  rejectedApproaches: [],
  nextSteps: [],
  requiredSourceRefs: ["message:original"],
  sourcePassages: [{ sourceRef: "message:original", text: "Never reset the database." }],
};

function runtimeFor(generate: typeof HandoffGeneration.Service.generate, sourceEnabled = false) {
  const base = OrchestrationLayerLive.pipe(
    Layer.provideMerge(
      ProviderSessionDirectoryLive.pipe(Layer.provide(ProviderSessionRuntimeRepositoryLive)),
    ),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "glade-handoff-lifecycle-" }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
  const unavailable = () => Effect.die("Only destination model discovery is permitted.");
  return ManagedRuntime.make(
    HandoffPreparationLive.pipe(
      Layer.provideMerge(base),
      Layer.provideMerge(HandoffTransitionsLive.pipe(Layer.provideMerge(base))),
      Layer.provide(Layer.succeed(HandoffGeneration, { generate })),
      Layer.provide(
        ServerSettingsService.layerTest({
          providers: { codex: { enabled: true }, claudeAgent: { enabled: sourceEnabled } },
        }),
      ),
      Layer.provide(
        Layer.succeed(ProviderDiscoveryService, {
          getComposerCapabilities: unavailable,
          listCommands: unavailable,
          listSkills: unavailable,
          listPlugins: unavailable,
          readPlugin: unavailable,
          listAgents: unavailable,
          listModels: (input) => {
            expect(input.provider === "codex" || sourceEnabled).toBe(true);
            return Effect.succeed({ models: [] });
          },
        }),
      ),
    ),
  );
}

const createHandoff = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const projectId = ProjectId.makeUnsafe("project");
  const createdAt = "2026-10-01T00:00:00.000Z";
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.makeUnsafe("project"),
    projectId,
    title: "Project",
    workspaceRoot: process.cwd(),
    defaultModelSelection: null,
    createdAt,
  });
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.makeUnsafe("source"),
    threadId,
    projectId,
    title: "Source",
    modelSelection: { provider: "claudeAgent", model: "unavailable-source" },
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    createdAt,
  });
  yield* seedUserMessage({
    threadId,
    messageId: MessageId.makeUnsafe("original"),
    text: "Never reset the database.",
    createdAt,
  });
  yield* engine.dispatch({
    type: "thread.handoff.start",
    commandId: CommandId.makeUnsafe("handoff"),
    threadId,
    modelSelection: { provider: "codex", model: "selected-destination" },
    runtimeMode: "approval-required",
    createdAt,
  });
});

// Native generation is replaced here only to exercise durable billing/retry and cancellation
// ownership. Semantic quality and native tool isolation require separate live verification.
describe("handoff preparation lifecycle", () => {
  it("retries failed destination generation, persists context and reuses it without duplicate calls", async () => {
    let calls = 0;
    const runtime = runtimeFor((input) => {
      expect(input.modelSelection).toEqual({ provider: "codex", model: "selected-destination" });
      calls += 1;
      return calls === 1
        ? Effect.fail(
            new ProviderValidationError({
              operation: "handoff.prepare",
              issue: "Destination quota unavailable",
            }),
          )
        : Effect.succeed({ record, inputTokens: 123, outputTokens: 45 });
    });
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          yield* createHandoff;
          const preparation = yield* HandoffPreparation;
          const query = yield* ProjectionSnapshotQuery;
          expect((yield* preparation.prepare({ threadId }).pipe(Effect.result))._tag).toBe(
            "Failure",
          );
          const text = yield* preparation.prepare({ threadId });
          expect(text).toContain("Never reset the database.");
          expect(yield* preparation.prepare({ threadId })).toBe(text);
          expect(calls).toBe(2);
          const saved = Option.getOrThrow(yield* query.getThreadDetailById(threadId));
          expect(saved.handoff?.bootstrapStatus).toBe("pending");
          expect(saved.handoff?.preparation?.passes).toBe(2);
          expect(saved.handoff?.preparation?.inputTokens).toBeNull();
          expect(saved.messages.map((message) => message.text)).toEqual([
            "Never reset the database.",
          ]);
        }),
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("cancels isolated preparation without completing bootstrap", async () => {
    const entered = Deferred.makeUnsafe<void>();
    const runtime = runtimeFor(() =>
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
    );
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          yield* createHandoff;
          const preparation = yield* HandoffPreparation;
          const query = yield* ProjectionSnapshotQuery;
          const fiber = yield* Effect.forkChild(
            preparation.prepare({ threadId }).pipe(Effect.result),
          );
          yield* Deferred.await(entered);
          expect(yield* preparation.cancel(threadId)).toBe(true);
          expect((yield* Fiber.join(fiber))._tag).toBe("Failure");
          const saved = Option.getOrThrow(yield* query.getThreadDetailById(threadId));
          expect(saved.handoff?.bootstrapStatus).toBe("pending");
          expect(saved.handoff?.preparation).toBeUndefined();
          expect(saved.activities.at(-1)?.kind).toBe("handoff.preparation.cancelled");
        }),
      );
    } finally {
      await runtime.dispose();
    }
  });
  it.each(["conversation", "generation"] as const)(
    "rejects changed source %s while a destination pass is in flight",
    async (change) => {
      const entered = Deferred.makeUnsafe<void>();
      const finish = Deferred.makeUnsafe<void>();
      const runtime = runtimeFor(() =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(finish)),
          Effect.as({ record, inputTokens: 10, outputTokens: 10 }),
        ),
      );
      try {
        await runtime.runPromise(
          Effect.gen(function* () {
            const directory = yield* ProviderSessionDirectory;
            if (change === "generation")
              yield* directory.upsert({
                threadId,
                provider: "claudeAgent",
                lifecycleGeneration: "source-generation",
              });
            yield* createHandoff;
            const preparation = yield* HandoffPreparation;
            const fiber = yield* Effect.forkChild(
              preparation.prepare({ threadId }).pipe(Effect.result),
            );
            yield* Deferred.await(entered);
            if (change === "generation")
              yield* directory.upsert({
                threadId,
                provider: "claudeAgent",
                lifecycleGeneration: "replacement-generation",
              });
            else
              yield* seedUserMessage({
                threadId,
                messageId: MessageId.makeUnsafe("changed-source"),
                text: "A newer instruction",
                createdAt: new Date().toISOString(),
              });
            yield* Deferred.succeed(finish, undefined);
            expect((yield* Fiber.join(fiber))._tag).toBe("Failure");
            const query = yield* ProjectionSnapshotQuery;
            const saved = Option.getOrThrow(yield* query.getThreadDetailById(threadId));
            expect(saved.handoff?.preparation).toBeUndefined();
            expect(saved.handoff?.stage).toBe("failed");
            expect(saved.modelSelection.provider).toBe("claudeAgent");
          }),
        );
      } finally {
        await runtime.dispose();
      }
    },
  );

  it("returns to the original provider with earlier snapshot ancestry and retains both transition records after hydration", async () => {
    const runtime = runtimeFor(
      () => Effect.succeed({ record, inputTokens: 10, outputTokens: 10 }),
      true,
    );
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          yield* createHandoff;
          const preparation = yield* HandoffPreparation;
          const transitions = yield* HandoffTransitions;
          const query = yield* ProjectionSnapshotQuery;
          const engine = yield* OrchestrationEngineService;
          yield* preparation.prepare({ threadId });
          const first = Option.getOrThrow(yield* query.getThreadDetailById(threadId));
          yield* engine.dispatch({
            type: "thread.meta.update",
            commandId: CommandId.makeUnsafe("activated-first"),
            threadId,
            expectedHandoffOperationId: CommandId.makeUnsafe("handoff"),
            modelSelection: first.handoff!.destinationModelSelection!,
          });
          yield* transitions.update(threadId, CommandId.makeUnsafe("handoff"), {
            stage: "delivered",
            bootstrapStatus: "completed",
          });
          yield* engine.dispatch({
            type: "thread.handoff.start",
            commandId: CommandId.makeUnsafe("return-provider"),
            threadId,
            modelSelection: { provider: "claudeAgent", model: "return-model" },
            runtimeMode: "approval-required",
            createdAt: new Date().toISOString(),
          });
          yield* engine.refreshCommandReadModel();
          const second = Option.getOrThrow(yield* query.getThreadDetailForExportById(threadId));
          expect(second.handoff!.sourceBoundarySequence!).toBeGreaterThan(
            first.handoff!.sourceBoundarySequence!,
          );
          const events = yield* OrchestrationEventStore;
          const frozen = yield* readHandoffEvidenceSnapshot(
            events,
            threadId,
            second.handoff!.sourceBoundarySequence!,
          );
          expect(frozen.messages.map((message) => message.id)).toEqual(["original"]);
          expect(frozen.handoff?.operationId).toBe("handoff");
          expect(
            second.activities.filter((activity) => activity.kind === "provider.transition"),
          ).toHaveLength(2);
          expect(
            second.activities.find((activity) => activity.id === "handoff-transition:handoff")
              ?.summary,
          ).toContain("delivered");
          yield* preparation.prepare({ threadId });
          expect(
            Option.getOrThrow(yield* query.getThreadShellById(threadId)).handoff?.preparation
              ?.modelSelection.model,
          ).toBe("return-model");
        }),
      );
    } finally {
      await runtime.dispose();
    }
  });
});
