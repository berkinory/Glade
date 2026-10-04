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

const target = ThreadId.makeUnsafe("target");
const source = ThreadId.makeUnsafe("source");
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

function runtimeFor(generate: typeof HandoffGeneration.Service.generate) {
  const base = OrchestrationLayerLive.pipe(
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
      Layer.provide(Layer.succeed(HandoffGeneration, { generate })),
      Layer.provide(
        ServerSettingsService.layerTest({
          providers: { codex: { enabled: true }, claudeAgent: { enabled: false } },
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
            expect(input.provider).toBe("codex");
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
    threadId: source,
    projectId,
    title: "Source",
    modelSelection: { provider: "claudeAgent", model: "unavailable-source" },
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    createdAt,
  });
  yield* seedUserMessage({
    threadId: source,
    messageId: MessageId.makeUnsafe("original"),
    text: "Never reset the database.",
    createdAt,
  });
  yield* engine.dispatch({
    type: "thread.handoff.create",
    commandId: CommandId.makeUnsafe("handoff"),
    threadId: target,
    sourceThreadId: source,
    projectId,
    title: "Target",
    modelSelection: { provider: "codex", model: "selected-destination" },
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    importedMessages: [],
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
          expect((yield* preparation.prepare({ threadId: target }).pipe(Effect.result))._tag).toBe(
            "Failure",
          );
          const text = yield* preparation.prepare({ threadId: target });
          expect(text).toContain("Never reset the database.");
          expect(yield* preparation.prepare({ threadId: target })).toBe(text);
          expect(calls).toBe(2);
          const saved = Option.getOrThrow(yield* query.getThreadDetailById(target));
          expect(saved.handoff?.bootstrapStatus).toBe("pending");
          expect(saved.handoff?.preparation?.passes).toBe(2);
          expect(saved.handoff?.preparation?.inputTokens).toBeNull();
          expect(saved.messages).toHaveLength(1);
          expect(
            Option.getOrThrow(yield* query.getThreadDetailById(source)).messages[0]?.text,
          ).toBe("Never reset the database.");
        }),
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("cancels isolated preparation without completing bootstrap or removing the source", async () => {
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
            preparation.prepare({ threadId: target }).pipe(Effect.result),
          );
          yield* Deferred.await(entered);
          expect(yield* preparation.cancel(target)).toBe(true);
          expect((yield* Fiber.join(fiber))._tag).toBe("Failure");
          const saved = Option.getOrThrow(yield* query.getThreadDetailById(target));
          expect(saved.handoff?.bootstrapStatus).toBe("pending");
          expect(saved.handoff?.preparation).toBeUndefined();
          expect(saved.activities.at(-1)?.kind).toBe("handoff.preparation.cancelled");
          expect(Option.isSome(yield* query.getThreadShellById(source))).toBe(true);
        }),
      );
    } finally {
      await runtime.dispose();
    }
  });
});
