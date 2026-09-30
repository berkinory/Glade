import { assert, it } from "@effect/vitest";
import {
  AutomationId,
  AutomationRunId,
  CommandId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import {
  type AutomationListResult,
  DEFAULT_AUTOMATION_STOP_CONFIDENCE_THRESHOLD,
  type AutomationCreateInput,
  type AutomationRun,
} from "@glade/contracts/automation/automation";
import {
  type GitCreateDetachedWorktreeInput,
  type GitRemoveWorktreeInput,
} from "@glade/contracts/git/git";
import { type OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import {
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@glade/contracts/orchestration/threadEntities";

import { Duration, Effect, Layer, Option, Stream } from "effect";
import { TestClock } from "effect/testing";

import { resolveAgentGatewayTarget } from "../../agentGateway/targetResolver.ts";
import { readModelSelectionArg } from "../../agentGateway/toolInput.ts";
import type { ProviderDiscoveryServiceShape } from "../../provider/Services/ProviderDiscoveryService.ts";
import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import { TextGeneration, type TextGenerationShape } from "../../git/Services/TextGeneration.ts";
import { OrchestrationCommandInternalError } from "../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import type { OrchestrationEngineShape } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ProjectionSnapshotQueryShape } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AutomationRepositoryLive } from "../../persistence/Layers/AutomationRepository.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { AutomationRepository } from "../../persistence/Services/AutomationRepository.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { automationProposalActivityId } from "../proposalActivity.ts";
import { AutomationService, type AutomationServiceShape } from "../Services/AutomationService.ts";
import { AutomationServiceLive } from "./AutomationService.ts";

const now = "2026-06-16T10:00:00.000Z";
const projectId = ProjectId.makeUnsafe("automation-project");
const project: OrchestrationProjectShell = {
  id: projectId,
  kind: "project",
  title: "Automation Project",
  workspaceRoot: "/tmp/automation-project",
  defaultModelSelection: {
    provider: "codex",
    model: "gpt-5-codex",
  },
  scripts: [],
  isPinned: false,
  createdAt: now,
  updatedAt: now,
};

const dispatchedCommands: OrchestrationCommand[] = [];
const createdWorktrees: GitCreateDetachedWorktreeInput[] = [];
const removedWorktrees: GitRemoveWorktreeInput[] = [];
type CompletionEvaluationInputForTest = Parameters<
  TextGenerationShape["evaluateAutomationCompletion"]
>[0];
let gitMode: "nonRepo" | "worktree" = "nonRepo";
let gitStatusHook: ((cwd: string) => Effect.Effect<void>) | null = null;
let createWorktreeHook: ((input: GitCreateDetachedWorktreeInput) => Effect.Effect<void>) | null =
  null;

let threadShell: Option.Option<OrchestrationThreadShell> = Option.none();
let threadDetail: Option.Option<unknown> = Option.none();
let completionEvaluation: {
  readonly stopMatched: boolean;
  readonly confidence: number;
  readonly reason: string;
} = {
  stopMatched: false,
  confidence: 0.2,
  reason: "Stop condition was not met.",
};
let completionEvaluationFailure: Error | null = null;
let completionEvaluationInputs: CompletionEvaluationInputForTest[] = [];
let completionEvaluationGate: {
  readonly started: () => void;
  readonly wait: Promise<void>;
} | null = null;

let failDispatchType: OrchestrationCommand["type"] | null = null;
let dispatchHook:
  | ((command: OrchestrationCommand) => Effect.Effect<void, OrchestrationCommandInternalError>)
  | null = null;
let projectLookupHook: (() => Effect.Effect<void>) | null = null;
let threadShellLookupHook: (() => Effect.Effect<void>) | null = null;

function resetHarness() {
  dispatchedCommands.length = 0;
  createdWorktrees.length = 0;
  removedWorktrees.length = 0;
  gitMode = "nonRepo";
  gitStatusHook = null;
  createWorktreeHook = null;
  threadShell = Option.none();
  threadDetail = Option.none();
  completionEvaluation = {
    stopMatched: false,
    confidence: 0.2,
    reason: "Stop condition was not met.",
  };
  completionEvaluationFailure = null;
  completionEvaluationInputs = [];
  completionEvaluationGate = null;
  failDispatchType = null;
  dispatchHook = null;
  projectLookupHook = null;
  threadShellLookupHook = null;
}

function makeThreadShell(overrides: {
  readonly id?: ThreadId;
  readonly projectId?: ProjectId;
  readonly latestTurn?: OrchestrationThreadShell["latestTurn"];
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly lastError?: string | null;
  readonly modelSelection?: OrchestrationThreadShell["modelSelection"];
}): OrchestrationThreadShell {
  return {
    id: overrides.id ?? ThreadId.makeUnsafe("thread-shell"),
    projectId: overrides.projectId ?? projectId,
    modelSelection: overrides.modelSelection ?? { provider: "codex", model: "gpt-5-codex" },
    latestTurn: overrides.latestTurn ?? null,
    hasPendingApprovals: overrides.hasPendingApprovals,
    hasPendingUserInput: overrides.hasPendingUserInput,
    session: overrides.lastError !== undefined ? { lastError: overrides.lastError } : null,
  } as unknown as OrchestrationThreadShell;
}

function makeLatestTurn(
  state: "running" | "completed" | "error" | "interrupted",
  turnId: TurnId = TurnId.makeUnsafe("turn-reconcile"),
): OrchestrationThreadShell["latestTurn"] {
  return {
    turnId,
    state,
    requestedAt: now,
    startedAt: now,
    completedAt: state === "completed" ? now : null,
    assistantMessageId: null,
  } as unknown as OrchestrationThreadShell["latestTurn"];
}

function makeThreadDetailForRun(input: {
  readonly runId: AutomationRunId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly messageId: MessageId;
  readonly userText: string;
  readonly assistantText: string | null;
  readonly extraMessages?:
    | ReadonlyArray<{
        readonly id: MessageId;
        readonly role: string;
        readonly text: string;
        readonly turnId: TurnId | null;
        readonly streaming: boolean;
        readonly source: string;
        readonly createdAt: string;
        readonly updatedAt: string;
      }>
    | undefined;
}) {
  return {
    ...makeThreadShell({
      id: input.threadId,
      latestTurn: makeLatestTurn("completed", input.turnId),
    }),
    messages: [
      {
        id: input.messageId,
        role: "user",
        text: input.userText,
        turnId: input.turnId,
        streaming: false,
        source: "native",
        createdAt: now,
        updatedAt: now,
      },
      ...(input.assistantText === null
        ? []
        : [
            {
              id: MessageId.makeUnsafe(`assistant-${input.runId}`),
              role: "assistant",
              text: input.assistantText,
              turnId: input.turnId,
              streaming: false,
              source: "native",
              createdAt: now,
              updatedAt: now,
            },
          ]),
      ...(input.extraMessages ?? []),
    ],
  };
}

function aiCompletionPolicy(stopWhen: string) {
  return {
    type: "ai-evaluated" as const,
    stopWhen,
    confidenceThreshold: DEFAULT_AUTOMATION_STOP_CONFIDENCE_THRESHOLD,
  };
}

function reconcileAutomationRun(input: {
  readonly service: AutomationServiceShape;
  readonly run: AutomationRun;
  readonly state: "completed" | "error";
  readonly error?: string;
}) {
  const threadId = input.run.threadId;
  if (threadId === null) {
    return Effect.die("Expected the automation run to have a thread id.");
  }
  threadShell = Option.some(
    makeThreadShell({
      id: threadId,
      latestTurn: makeLatestTurn(
        input.state,
        TurnId.makeUnsafe(`turn-${input.state}-${input.run.id}`),
      ),
      ...(input.error !== undefined ? { lastError: input.error } : {}),
    }),
  );
  return input.service.reconcileThread({ threadId });
}

function completeAutomationRun(input: {
  readonly run: AutomationRun;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly userText?: string;
  readonly assistantText?: string | null;
  readonly extraMessages?: Parameters<typeof makeThreadDetailForRun>[0]["extraMessages"];
}) {
  return Effect.gen(function* () {
    const projectionTurns = yield* ProjectionTurnRepository;
    const messageId = input.run.messageId;
    if (messageId === null) {
      throw new Error("Expected the automation run to have a pending message id.");
    }
    yield* projectionTurns.upsertByTurnId({
      threadId: input.threadId,
      turnId: input.turnId,
      pendingMessageId: messageId,
      sourceProposedPlanThreadId: null,
      sourceProposedPlanId: null,
      assistantMessageId: null,
      state: "completed",
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      checkpointTurnCount: null,
      checkpointRef: null,
      checkpointStatus: null,
      checkpointFiles: [],
    });
    threadShell = Option.some(
      makeThreadShell({
        id: input.threadId,
        latestTurn: makeLatestTurn("completed", input.turnId),
      }),
    );
    threadDetail = Option.some(
      makeThreadDetailForRun({
        runId: input.run.id,
        threadId: input.threadId,
        turnId: input.turnId,
        messageId,
        userText: input.userText ?? "Check whether the PR is ready.",
        assistantText: input.assistantText === undefined ? "The PR is ready." : input.assistantText,
        extraMessages: input.extraMessages,
      }),
    );
  });
}

function holdCompletionEvaluation() {
  let releaseEvaluation: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    completionEvaluationGate = {
      started: resolve,
      wait: new Promise<void>((release) => {
        releaseEvaluation = release;
      }),
    };
  });
  return {
    started,
    release: () => releaseEvaluation(),
  };
}

function realDelay(ms: number) {
  return Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

function waitForPromise(input: {
  readonly promise: Promise<void>;
  readonly timeoutMs: number;
  readonly description: string;
}) {
  return Effect.promise(
    () =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${input.description}.`)),
          input.timeoutMs,
        );
        input.promise.then(
          () => {
            clearTimeout(timer);
            resolve();
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      }),
  );
}

function waitForAutomationList(input: {
  readonly service: AutomationServiceShape;
  readonly description: string;
  readonly predicate: (listed: AutomationListResult) => boolean;
}) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const listed = yield* input.service.list({ projectId });
      if (input.predicate(listed)) {
        return listed;
      }
      yield* realDelay(10);
    }
    throw new Error(`Timed out waiting for ${input.description}.`);
  });
}

const createInput = (
  worktreeMode: AutomationCreateInput["worktreeMode"] = "local",
): AutomationCreateInput => ({
  name: "Nightly maintenance",
  projectId,
  prompt: "Check stale dependencies.",
  schedule: { type: "manual" },
  modelSelection: {
    provider: "codex",
    model: "gpt-5-codex",
  },
  worktreeMode,
  stopAfterConsecutiveFailures: 1,
  acknowledgedRisks: worktreeMode === "local" ? ["local-checkout"] : [],
});

const orchestrationEngine = {
  quiesce: Effect.void,
  drain: Effect.void,
  stop: Effect.void,
  getProjectionCatchUpStatus: Effect.succeed({
    state: "healthy" as const,
    inFlight: false,
    retryAttempts: 0,
    lastFailure: null,
    highWaterSequence: 0,
    lagByProjector: {},
    missingProjectors: [],
  }),
  readEvents: () => Stream.empty,
  readEventsThrough: () => Stream.empty,
  readThreadEvents: () => Stream.empty,
  readThreadEventsThrough: () => Stream.empty,
  getEventHighWaterSequence: Effect.succeed(0),
  getThreadTitleHighWaterSequence: () => Effect.succeed(0),
  subscribeDomainEvents: Effect.succeed(Stream.empty),
  getReadModel: () =>
    Effect.succeed({
      snapshotSequence: 0,
      spaces: [],
      projects: [],
      threads: [],
      updatedAt: now,
    }),
  refreshCommandReadModel: () =>
    Effect.succeed({
      snapshotSequence: 0,
      spaces: [],
      projects: [],
      threads: [],
      updatedAt: now,
    }),
  dispatch: (command: OrchestrationCommand) =>
    failDispatchType !== null && command.type === failDispatchType
      ? Effect.fail(
          new OrchestrationCommandInternalError({
            commandId: command.commandId,
            commandType: command.type,
            detail: "dispatch rejected by test harness",
          }),
        )
      : Effect.gen(function* () {
          if (dispatchHook) {
            yield* dispatchHook(command);
          }
          dispatchedCommands.push(command);
          return { sequence: dispatchedCommands.length };
        }),
  repairState: () =>
    Effect.succeed({
      snapshotSequence: 0,
      spaces: [],
      projects: [],
      threads: [],
      updatedAt: now,
    }),
  streamDomainEvents: Stream.empty,
} satisfies OrchestrationEngineShape;

const projectionSnapshotQuery = {
  getCommandReadModel: () =>
    Effect.succeed({
      snapshotSequence: 0,
      spaces: [],
      projects: [],
      threads: [],
      updatedAt: now,
    }),
  getSnapshot: () =>
    Effect.succeed({
      snapshotSequence: 0,
      spaces: [],
      projects: [],
      threads: [],
      updatedAt: now,
    }),
  getCounts: () => Effect.succeed({ projectCount: 1, threadCount: 0 }),
  getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
  getShellSnapshot: () => {
    const snapshot = {
      snapshotSequence: 0,
      spaces: [],
      projects: [project],
      threads: [],
      updatedAt: now,
    };
    return projectLookupHook
      ? projectLookupHook().pipe(Effect.as(snapshot))
      : Effect.succeed(snapshot);
  },
  getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.some(project as never)),
  getProjectShellById: () => Effect.succeed(Option.some(project)),
  getSpaceShellById: () => Effect.succeed(Option.none()),
  getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
  getThreadCheckpointContext: () => Effect.succeed(Option.none()),
  getFullThreadDiffContext: () => Effect.succeed(Option.none()),
  getThreadShellById: () =>
    threadShellLookupHook
      ? threadShellLookupHook().pipe(Effect.as(threadShell))
      : Effect.succeed(threadShell),
  findSyntheticSubagentParentThread: () => Effect.succeed(Option.none()),
  getThreadDetailById: () => Effect.succeed(threadDetail as never),
  getThreadDetailForExportById: () => Effect.succeed(threadDetail as never),
  getThreadDetailSnapshotById: () => Effect.succeed(Option.none()),
} as unknown as ProjectionSnapshotQueryShape;

const textGeneration = {
  generateCommitMessage: () => Effect.die("unused"),
  generatePrContent: () => Effect.die("unused"),
  generateDiffSummary: () => Effect.die("unused"),
  generateBranchName: () => Effect.die("unused"),
  generateThreadTitle: () => Effect.die("unused"),
  generateAutomationIntent: () => Effect.die("unused"),
  evaluateAutomationCompletion: (input: CompletionEvaluationInputForTest) => {
    completionEvaluationInputs.push(input);
    if (completionEvaluationFailure) {
      return Effect.fail(completionEvaluationFailure);
    }
    const gate = completionEvaluationGate;
    return gate
      ? Effect.promise(async () => {
          gate.started();
          await gate.wait;
          return completionEvaluation;
        })
      : Effect.succeed(completionEvaluation);
  },
} as unknown as TextGenerationShape;

const gitCore = {
  statusDetails: (cwd: string) =>
    Effect.gen(function* () {
      if (gitStatusHook) {
        yield* gitStatusHook(cwd);
      }
      return {
        isRepo: gitMode === "worktree",
        hasOriginRemote: false,
        isDefaultBranch: true,
        branch: gitMode === "worktree" ? "main" : null,
        upstreamRef: null,
        upstreamBranch: null,
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0,
        cwd,
      };
    }),
  createDetachedWorktree: (input: GitCreateDetachedWorktreeInput) =>
    Effect.gen(function* () {
      createdWorktrees.push(input);
      if (createWorktreeHook) {
        yield* createWorktreeHook(input);
      }
      return {
        worktree: {
          path: "/tmp/automation-worktree",
          ref: "0123456789abcdef0123456789abcdef01234567",
          branch: input.newBranch ?? null,
        },
      };
    }),
  removeWorktree: (input: GitRemoveWorktreeInput) =>
    Effect.sync(() => {
      removedWorktrees.push(input);
    }),
} as unknown as GitCoreShape;

const layer = it.layer(
  AutomationServiceLive.pipe(
    Layer.provideMerge(AutomationRepositoryLive),
    Layer.provideMerge(ProjectionTurnRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(Layer.succeed(OrchestrationEngineService, orchestrationEngine)),
    Layer.provideMerge(Layer.succeed(ProjectionSnapshotQuery, projectionSnapshotQuery)),
    Layer.provideMerge(Layer.succeed(TextGeneration, textGeneration)),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(Layer.succeed(GitCore, gitCore)),
  ),
);

layer("AutomationService", (it) => {
  it.effect("persists discovered Claude Auto targets through exact-target create and update", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const target = readModelSelectionArg(
        { target: { provider: "claudeAgent", model: "claude-sonnet-5" } },
        "target",
      )!;
      const resolved = yield* resolveAgentGatewayTarget({
        target,
        discovery: {
          listModels: () =>
            Effect.succeed({
              models: [{ slug: "claude-sonnet-5", name: "Sonnet", supportsAutoMode: true }],
            }),
        } as unknown as ProviderDiscoveryServiceShape,
      });
      const created = yield* service.create({
        ...createInput(),
        runtimeMode: "auto",
        modelSelection: resolved,
      });
      assert.deepEqual(created.modelSelection, {
        provider: "claudeAgent",
        model: target.model,
        supportsAutoMode: true,
      });
      const updated = yield* service.update({
        id: created.id,
        modelSelection: resolved,
        name: "Retargeted Auto",
      });
      assert.strictEqual(updated.runtimeMode, "auto");
      const listed = yield* service.list({ projectId });
      assert.deepEqual(
        listed.definitions.find((entry) => entry.id === created.id)?.modelSelection,
        { provider: "claudeAgent", model: target.model, supportsAutoMode: true },
      );
    }),
  );

  it.effect("rejects provider changes while the first dedicated run is opening its task", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const created = yield* service.create({ ...createInput(), mode: "dedicated" });
      let rejection: string | undefined;
      dispatchHook = (command) =>
        command.type === "thread.create"
          ? service
              .update({
                id: created.id,
                modelSelection: { provider: "claudeAgent", model: "claude-sonnet-5" },
              })
              .pipe(
                Effect.match({
                  onFailure: (error) => {
                    rejection = error.message;
                  },
                  onSuccess: () => assert.fail("Expected the active provider change to fail."),
                }),
              )
          : Effect.void;
      yield* service.runNow({ automationId: created.id });
      assert.match(rejection!, /while a run is active/);
      const listed = yield* service.list({ projectId });
      assert.deepEqual(
        listed.definitions.find((entry) => entry.id === created.id)?.modelSelection,
        created.modelSelection,
      );
    }),
  );

  it.effect("rejects Claude Auto automations for models that do not support Auto", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const unsupportedModelSelection = {
        provider: "claudeAgent" as const,
        model: "claude-haiku-4-5",
        supportsAutoMode: false,
      };

      const createError = yield* service
        .create({
          ...createInput(),
          modelSelection: unsupportedModelSelection,
          runtimeMode: "auto",
        })
        .pipe(Effect.flip);
      assert.match(createError.message, /does not support Auto mode/);

      const definition = yield* service.create({
        ...createInput(),
        modelSelection: {
          ...unsupportedModelSelection,
          supportsAutoMode: true,
        },
        runtimeMode: "auto",
      });
      const updateError = yield* service
        .update({
          id: definition.id,
          modelSelection: unsupportedModelSelection,
        })
        .pipe(Effect.flip);
      assert.match(updateError.message, /does not support Auto mode/);
    }),
  );

  it.effect("accepts and dismisses persisted automation proposals", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const acceptedProposal = yield* service.create({
        ...createInput(),
        sourceThreadId: ThreadId.makeUnsafe("proposal-source-thread"),
        enabled: false,
        proposalState: "pending",
      });
      const dismissedProposal = yield* service.create({
        ...createInput(),
        name: "Dismiss me",
        sourceThreadId: ThreadId.makeUnsafe("proposal-source-thread"),
        enabled: false,
        proposalState: "pending",
      });

      const accepted = yield* service.resolveProposal({
        automationId: acceptedProposal.id,
        resolution: "accepted",
      });
      const dismissed = yield* service.resolveProposal({
        automationId: dismissedProposal.id,
        resolution: "dismissed",
      });

      assert.strictEqual(accepted.definition.proposalState, "accepted");
      assert.isTrue(accepted.definition.enabled);
      assert.strictEqual(dismissed.definition.proposalState, "dismissed");
      assert.isFalse(dismissed.definition.enabled);
      assert.isNotNull(dismissed.definition.archivedAt);
      const proposalActivities = dispatchedCommands.filter(
        (command) => command.type === "thread.activity.append",
      );
      assert.deepStrictEqual(
        proposalActivities.map((command) =>
          command.type === "thread.activity.append"
            ? {
                id: command.activity.id,
                state: (command.activity.payload as Record<string, unknown>).proposalState,
              }
            : null,
        ),
        [
          {
            id: automationProposalActivityId(acceptedProposal.id),
            state: "accepted",
          },
          {
            id: automationProposalActivityId(dismissedProposal.id),
            state: "dismissed",
          },
        ],
      );
    }),
  );

  it.effect("retries an update after a concurrent scheduler write", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const created = yield* service.create(createInput());
      projectLookupHook = () => {
        projectLookupHook = null;
        return Effect.gen(function* () {
          yield* repository.incrementDefinitionIterationCount({
            id: created.id,
            now: "2026-06-16T10:01:00.000Z",
          });
          const moved = Option.getOrThrow(yield* repository.getDefinitionById({ id: created.id }));
          assert.strictEqual(moved.iterationCount, 1);
          assert.notStrictEqual(moved.updatedAt, created.updatedAt);
        }).pipe(Effect.orDie);
      };

      const updated = yield* service.update({ id: created.id, name: "Updated after conflict" });

      assert.strictEqual(updated.name, "Updated after conflict");
      assert.strictEqual(updated.iterationCount, 1);
    }),
  );

  it.effect("fails an update after three concurrent write conflicts", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const created = yield* service.create(createInput());
      let schedulerWrites = 0;
      projectLookupHook = () => {
        schedulerWrites += 1;
        return repository
          .incrementDefinitionIterationCount({
            id: created.id,
            now: `2026-06-16T10:00:0${schedulerWrites}.000Z`,
          })
          .pipe(Effect.orDie);
      };

      const error = yield* service
        .update({ id: created.id, name: "Never persisted" })
        .pipe(Effect.flip);

      assert.strictEqual(schedulerWrites, 3);
      assert.match(error.message, /changed while saving.*Try again/);
      const reloaded = Option.getOrThrow(yield* repository.getDefinitionById({ id: created.id }));
      assert.strictEqual(reloaded.name, created.name);
      assert.strictEqual(reloaded.iterationCount, 3);
    }),
  );

  it.effect("rejects unauthorized and oversized automation memory writes", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const created = yield* service.create(createInput());

      const unauthorized = yield* service
        .updateMemory({
          automationId: created.id,
          content: "not mine",
          callerThreadId: ThreadId.makeUnsafe("unrelated-thread"),
          callerTurnId: TurnId.makeUnsafe("unrelated-turn"),
        })
        .pipe(Effect.flip);
      const oversized = yield* service
        .updateMemory({
          automationId: created.id,
          content: "x".repeat(32 * 1_024 + 1),
          callerThreadId: ThreadId.makeUnsafe("unrelated-thread"),
          callerTurnId: TurnId.makeUnsafe("unrelated-turn"),
        })
        .pipe(Effect.flip);

      assert.match(unauthorized.message, /not dispatched by an automation/);
      assert.match(oversized.message, /32 KiB/);
    }),
  );

  it.effect("keeps a dedicated automation inside the one thread it owns", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const created = yield* service.create({
        ...createInput("local"),
        mode: "dedicated",
        heartbeatCooldownSeconds: 0,
      });

      assert.strictEqual(created.targetThreadId, null);

      const first = yield* service.runNow({ automationId: created.id });
      const threadCreate = dispatchedCommands[0];
      if (threadCreate?.type !== "thread.create") {
        assert.fail("Expected the first dedicated run to open a thread.");
      }

      assert.strictEqual(threadCreate.title, "Nightly maintenance");

      assert.strictEqual(threadCreate.creationSource, undefined);
      const dedicatedThreadId = threadCreate.threadId;
      assert.strictEqual(first.run.threadId, dedicatedThreadId);

      yield* waitForAutomationList({
        service,
        description: "the dedicated automation to claim its thread",
        predicate: (listed) =>
          listed.definitions.find((entry) => entry.id === created.id)?.targetThreadId ===
          dedicatedThreadId,
      });

      yield* completeAutomationRun({
        run: first.run,
        threadId: dedicatedThreadId,
        turnId: TurnId.makeUnsafe("turn-dedicated-first"),
      });
      yield* service.reconcileThread({ threadId: dedicatedThreadId });
      yield* waitForAutomationList({
        service,
        description: "the first dedicated run to finish",
        predicate: (listed) =>
          listed.runs.find((entry) => entry.id === first.run.id)?.status === "succeeded",
      });

      const second = yield* service.runNow({ automationId: created.id });

      assert.strictEqual(second.run.threadId, dedicatedThreadId);
      assert.strictEqual(second.run.threadCreateCommandId, null);
      assert.strictEqual(
        dispatchedCommands.filter((command) => command.type === "thread.create").length,
        1,
      );
    }),
  );

  it.effect("cleans up a new worktree when standalone thread creation fails", () =>
    Effect.gen(function* () {
      resetHarness();
      gitMode = "worktree";
      failDispatchType = "thread.create";
      const service = yield* AutomationService;
      const created = yield* service.create(createInput("worktree"));

      const error = yield* service.runNow({ automationId: created.id }).pipe(Effect.flip);

      assert.match(error.message, /Failed to create automation thread/);
      assert.strictEqual(createdWorktrees.length, 1);
      assert.deepStrictEqual(removedWorktrees, [
        {
          cwd: project.workspaceRoot,
          path: "/tmp/automation-worktree",
          force: true,
          reclaimTemporaryBranch: true,
        },
      ]);

      const reloaded = yield* service.list({ projectId });
      const run = reloaded.runs.find((entry) => entry.automationId === created.id);
      assert.strictEqual(run?.status, "failed");
    }),
  );

  it.effect("cleans up a new worktree when cancellation wins before thread creation", () =>
    Effect.gen(function* () {
      resetHarness();
      gitMode = "worktree";
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.makeUnsafe("automation-cancel-after-worktree");

      yield* repository.createDefinition({
        id: automationId,
        input: {
          ...createInput("worktree"),
          schedule: { type: "interval", everySeconds: 300 },
          stopAfterConsecutiveFailures: 1,
        },
        now: "2026-06-16T10:00:00.000Z",
      });

      createWorktreeHook = () =>
        Effect.gen(function* () {
          const runs = yield* repository
            .listActiveRunsForDefinition({ automationId })
            .pipe(Effect.orDie);
          const run = runs.find((entry) => entry.automationId === automationId);
          if (run) {
            yield* repository
              .cancelRun({
                runId: run.id,
                now: "2026-06-16T10:00:30.000Z",
              })
              .pipe(Effect.orDie);
          }
        });

      const results = yield* service.runDueOnce({
        now: "2026-06-16T10:00:00.000Z",
        limit: 10,
        leaseOwnerId: "test-scheduler",
      });

      assert.strictEqual(createdWorktrees.length, 1);
      assert.deepStrictEqual(removedWorktrees, [
        {
          cwd: project.workspaceRoot,
          path: "/tmp/automation-worktree",
          force: true,
          reclaimTemporaryBranch: true,
        },
      ]);
      assert.strictEqual(
        results.find((entry) => entry.run.automationId === automationId)?.run.status,
        "cancelled",
      );
      assert.strictEqual(
        dispatchedCommands.some((command) => command.type === "thread.create"),
        false,
      );
    }),
  );

  it.effect("does not dispatch a run cancelled while resolving the environment", () =>
    Effect.gen(function* () {
      resetHarness();
      gitMode = "worktree";
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.makeUnsafe("automation-cancel-before-dispatch");

      yield* repository.createDefinition({
        id: automationId,
        input: {
          ...createInput("worktree"),
          schedule: { type: "interval", everySeconds: 300 },
          stopAfterConsecutiveFailures: 1,
        },
        now: "2026-06-16T10:00:00.000Z",
      });

      gitStatusHook = () =>
        Effect.gen(function* () {
          const runs = yield* repository
            .listActiveRunsForDefinition({ automationId })
            .pipe(Effect.orDie);
          const run = runs.find((entry) => entry.automationId === automationId);
          if (run) {
            yield* repository
              .cancelRun({
                runId: run.id,
                now: "2026-06-16T10:00:30.000Z",
              })
              .pipe(Effect.orDie);
          }
        });

      const results = yield* service.runDueOnce({
        now: "2026-06-16T10:00:00.000Z",
        limit: 10,
        leaseOwnerId: "test-scheduler",
      });

      assert.strictEqual(
        results.find((entry) => entry.run.automationId === automationId)?.run.status,
        "cancelled",
      );
      assert.strictEqual(
        dispatchedCommands.some(
          (command) => command.type === "thread.create" || command.type === "thread.turn.start",
        ),
        false,
      );
      assert.strictEqual(createdWorktrees.length, 0);
      const reloaded = yield* service.list({ projectId });
      const definition = reloaded.definitions.find((entry) => entry.id === automationId);
      assert.strictEqual(definition?.enabled, true);
    }),
  );

  it.effect("rejects auto local checkout fallback without acknowledgement", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;

      const created = yield* service.create(createInput("auto"));
      const error = yield* service.runNow({ automationId: created.id }).pipe(Effect.flip);

      assert.match(error.message, /local checkout fallback/);
      assert.strictEqual(
        dispatchedCommands.filter((command) => command.type === "thread.create").length,
        0,
      );
    }),
  );

  it.effect("blocks an unacknowledged full-access run at dispatch and records a failed run", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.makeUnsafe("automation-fullaccess-runnow");

      yield* repository.createDefinition({
        id: automationId,
        input: { ...createInput("worktree"), runtimeMode: "full-access", acknowledgedRisks: [] },
        now,
      });

      const error = yield* service.runNow({ automationId }).pipe(Effect.flip);

      assert.match(error.message, /full-access/);
      assert.strictEqual(
        dispatchedCommands.filter((command) => command.type === "thread.create").length,
        0,
      );
      const listed = yield* service.list({ projectId });
      assert.strictEqual(
        listed.runs.find((run) => run.automationId === automationId)?.status,
        "failed",
      );
    }),
  );

  it.effect("runs due scheduled automations once and advances the next run", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.makeUnsafe("automation-due-service");

      yield* repository.createDefinition({
        id: automationId,
        input: {
          ...createInput("local"),
          schedule: { type: "interval", everySeconds: 300 },
        },
        now: "2026-06-16T10:00:00.000Z",
      });

      const results = yield* service.runDueOnce({
        now: "2026-06-16T10:00:00.000Z",
        limit: 10,
        leaseOwnerId: "test-scheduler",
      });
      const listed = yield* service.list({ projectId });

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]?.run.trigger.type, "scheduled");
      assert.strictEqual(results[0]?.run.scheduledFor, "2026-06-16T10:00:00.000Z");
      assert.strictEqual(dispatchedCommands.length, 2);
      assert.strictEqual(
        listed.definitions.find((definition) => definition.id === automationId)?.nextRunAt,
        "2026-06-16T10:05:00.000Z",
      );
    }),
  );

  it.effect("records and advances missed scheduled occurrences when misfire policy is skip", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.makeUnsafe("automation-misfire-skip");

      yield* repository.createDefinition({
        id: automationId,
        input: {
          ...createInput("local"),
          schedule: { type: "interval", everySeconds: 300 },
          misfirePolicy: "skip",
        },
        now: "2026-06-16T10:00:00.000Z",
      });

      const results = yield* service.runDueOnce({
        now: "2026-06-16T10:11:00.000Z",
        limit: 10,
        leaseOwnerId: "test-scheduler",
      });

      assert.strictEqual(
        results.filter((entry) => entry.run.automationId === automationId).length,
        0,
      );
      const listed = yield* service.list({ projectId });
      const definition = listed.definitions.find((entry) => entry.id === automationId);
      const runs = listed.runs.filter((entry) => entry.automationId === automationId);
      assert.strictEqual(definition?.nextRunAt, "2026-06-16T10:15:00.000Z");
      assert.strictEqual(runs.length, 1);
      assert.strictEqual(runs[0]?.status, "skipped");
      yield* repository.disableDefinition({
        id: automationId,
        now: "2026-06-16T10:11:00.000Z",
        reason: "user",
      });
    }),
  );

  it.effect("runs one-shot automations once and disables them", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.makeUnsafe("automation-once-service");

      yield* repository.createDefinition({
        id: automationId,
        input: {
          ...createInput("local"),
          schedule: { type: "once", runAt: "2026-06-16T10:00:15.000Z" },
        },
        now: "2026-06-16T10:00:00.000Z",
      });

      const first = yield* service.runDueOnce({
        now: "2026-06-16T10:00:15.000Z",
        limit: 10,
        leaseOwnerId: "test-scheduler",
      });
      const second = yield* service.runDueOnce({
        now: "2026-06-16T10:00:20.000Z",
        limit: 10,
        leaseOwnerId: "test-scheduler",
      });
      const listed = yield* service.list({ projectId });

      assert.strictEqual(first.length, 1);
      assert.strictEqual(second.length, 0);
      const definition = listed.definitions.find((entry) => entry.id === automationId);
      assert.strictEqual(definition?.enabled, false);
      assert.strictEqual(definition?.nextRunAt, null);
      assert.strictEqual(
        listed.runs.filter((entry) => entry.automationId === automationId).length,
        1,
      );
    }),
  );

  it.effect("reconciles an error turn into a failed run with the session error", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;

      const created = yield* service.create(createInput("local"));
      const { run } = yield* service.runNow({ automationId: created.id });
      const threadId = run.threadId!;

      threadShell = Option.some(
        makeThreadShell({
          latestTurn: makeLatestTurn("error"),
          lastError: "provider exploded",
        }),
      );
      yield* service.reconcileThread({ threadId });

      const reloaded = yield* service.list({ projectId });
      const reconciled = reloaded.runs.find((entry) => entry.id === run.id);
      assert.strictEqual(reconciled?.status, "failed");
      assert.strictEqual(reconciled?.error, "provider exploded");
    }),
  );

  it.effect("interrupts a heartbeat run superseded by a strictly newer foreign turn", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const projectionTurns = yield* ProjectionTurnRepository;
      const targetThreadId = ThreadId.makeUnsafe("heartbeat-superseded");
      const automationTurnId = TurnId.makeUnsafe("turn-superseded-owned");
      const manualTurnId = TurnId.makeUnsafe("turn-superseded-manual");
      const later = "2026-06-16T10:05:00.000Z";
      threadShell = Option.some(makeThreadShell({ id: targetThreadId }));

      const created = yield* service.create({
        ...createInput("local"),
        mode: "heartbeat",
        targetThreadId,
      });
      const { run } = yield* service.runNow({ automationId: created.id });
      assert.isNotNull(run.messageId);

      yield* projectionTurns.upsertByTurnId({
        threadId: targetThreadId,
        turnId: automationTurnId,
        pendingMessageId: run.messageId,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        assistantMessageId: null,
        state: "running",
        requestedAt: now,
        startedAt: now,
        completedAt: null,
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
      });
      threadShell = Option.some(
        makeThreadShell({
          id: targetThreadId,
          latestTurn: {
            turnId: manualTurnId,
            state: "running",
            requestedAt: later,
            startedAt: later,
            completedAt: null,
            assistantMessageId: null,
          } as unknown as OrchestrationThreadShell["latestTurn"],
        }),
      );
      yield* service.reconcileThread({ threadId: targetThreadId });

      const reconciled = (yield* service.list({ projectId })).runs.find(
        (entry) => entry.id === run.id,
      );
      assert.strictEqual(reconciled?.status, "interrupted");
      assert.strictEqual(
        reconciled?.result?.summary,
        "Automation run was superseded by a newer turn on the target thread.",
      );
    }),
  );

  it.effect("keeps a queued heartbeat run pending behind an older active turn", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const projectionTurns = yield* ProjectionTurnRepository;
      const targetThreadId = ThreadId.makeUnsafe("heartbeat-queued-not-superseded");
      const automationTurnId = TurnId.makeUnsafe("turn-queued-owned");
      const olderTurnId = TurnId.makeUnsafe("turn-queued-older");
      const earlier = "2026-06-16T09:55:00.000Z";
      threadShell = Option.some(makeThreadShell({ id: targetThreadId }));

      const created = yield* service.create({
        ...createInput("local"),
        mode: "heartbeat",
        targetThreadId,
      });
      const { run } = yield* service.runNow({ automationId: created.id });
      assert.isNotNull(run.messageId);

      yield* projectionTurns.upsertByTurnId({
        threadId: targetThreadId,
        turnId: automationTurnId,
        pendingMessageId: run.messageId,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        assistantMessageId: null,
        state: "pending",
        requestedAt: now,
        startedAt: null,
        completedAt: null,
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
      });
      threadShell = Option.some(
        makeThreadShell({
          id: targetThreadId,
          latestTurn: {
            turnId: olderTurnId,
            state: "running",
            requestedAt: earlier,
            startedAt: earlier,
            completedAt: null,
            assistantMessageId: null,
          } as unknown as OrchestrationThreadShell["latestTurn"],
        }),
      );
      yield* service.reconcileThread({ threadId: targetThreadId });

      assert.strictEqual(
        (yield* service.list({ projectId })).runs.find((entry) => entry.id === run.id)?.status,
        "running",
      );
    }),
  );

  it.effect("times out active runs that exceed maxRuntimeSeconds", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.makeUnsafe("automation-timeout");
      const threadId = ThreadId.makeUnsafe("thread-timeout");
      const messageId = MessageId.makeUnsafe("message-timeout");
      const threadCreateCommandId = CommandId.makeUnsafe("command-timeout-thread");
      const turnStartCommandId = CommandId.makeUnsafe("command-timeout-turn");

      yield* repository.createDefinition({
        id: automationId,
        input: {
          ...createInput("local"),
          maxRuntimeSeconds: 1,
          stopAfterConsecutiveFailures: null,
        },
        now: "2000-01-01T00:00:00.000Z",
      });
      const run = yield* repository.createRun({
        id: AutomationRunId.makeUnsafe("run-timeout"),
        automationId,
        projectId,
        threadId,
        messageId,
        threadCreateCommandId,
        turnStartCommandId,
        trigger: { type: "manual" },
        scheduledFor: "2000-01-01T00:00:00.000Z",
        permissionSnapshot: {
          provider: "codex",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "approval-required",
          interactionMode: "default",
          worktreeMode: "local",
          allowedCapabilities: ["send-turn"],
          createdAt: "2000-01-01T00:00:00.000Z",
        },
        now: "2000-01-01T00:00:00.000Z",
      });
      yield* repository.markRunStarted({
        id: run.id,
        threadId,
        messageId,
        threadCreateCommandId,
        turnStartCommandId,
        startedAt: "2000-01-01T00:00:00.000Z",
      });

      yield* service.reconcileActiveRuns();

      const listed = yield* service.list({ projectId });
      const timedOut = listed.runs.find((entry) => entry.id === run.id);
      assert.strictEqual(timedOut?.status, "failed");
      assert.match(timedOut?.error ?? "", /runtime limit/);
      assert.isDefined(
        dispatchedCommands.find(
          (command) => command.type === "thread.turn.interrupt" && command.threadId === threadId,
        ),
      );
    }),
  );

  it.effect("does not overwrite a succeeded result when a timeout loses the race", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.makeUnsafe("automation-timeout-race");
      const runId = AutomationRunId.makeUnsafe("run-timeout-race");
      const threadId = ThreadId.makeUnsafe("thread-timeout-race");
      const messageId = MessageId.makeUnsafe("message-timeout-race");
      const threadCreateCommandId = CommandId.makeUnsafe("command-timeout-race-thread");
      const turnStartCommandId = CommandId.makeUnsafe("command-timeout-race-turn");

      yield* repository.createDefinition({
        id: automationId,
        input: {
          ...createInput("local"),
          maxRuntimeSeconds: 1,
          stopAfterConsecutiveFailures: null,
        },
        now: "2000-01-01T00:00:00.000Z",
      });
      const run = yield* repository.createRun({
        id: runId,
        automationId,
        projectId,
        threadId,
        messageId,
        threadCreateCommandId,
        turnStartCommandId,
        trigger: { type: "manual" },
        scheduledFor: "2000-01-01T00:00:00.000Z",
        permissionSnapshot: {
          provider: "codex",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "approval-required",
          interactionMode: "default",
          worktreeMode: "local",
          allowedCapabilities: ["send-turn"],
          createdAt: "2000-01-01T00:00:00.000Z",
        },
        now: "2000-01-01T00:00:00.000Z",
      });
      yield* repository.markRunStarted({
        id: run.id,
        threadId,
        messageId,
        threadCreateCommandId,
        turnStartCommandId,
        startedAt: "2000-01-01T00:00:00.000Z",
      });
      dispatchHook = (command) =>
        command.type === "thread.turn.interrupt"
          ? repository
              .markRunSucceeded({
                id: run.id,
                turnId: TurnId.makeUnsafe("turn-timeout-race-completed"),
                result: {
                  outcome: "no-findings",
                  summary: "Completed before timeout.",
                  unread: false,
                  archivedAt: null,
                },
                finishedAt: "2026-06-16T10:00:00.000Z",
                accountedAt: "2026-06-16T10:00:00.000Z",
              })
              .pipe(Effect.asVoid, Effect.orDie)
          : Effect.void;

      yield* service.reconcileActiveRuns();

      const listed = yield* service.list({ projectId });
      const reconciled = listed.runs.find((entry) => entry.id === run.id);
      assert.strictEqual(reconciled?.status, "succeeded");
      assert.strictEqual(reconciled?.result?.outcome, "no-findings");
      assert.strictEqual(reconciled?.result?.summary, "Completed before timeout.");
    }),
  );

  it.effect("runs a heartbeat automation by continuing the target thread", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const targetThreadId = ThreadId.makeUnsafe("heartbeat-target-thread");
      threadShell = Option.some(makeThreadShell({ id: targetThreadId }));

      const created = yield* service.create({
        ...createInput("local"),
        mode: "heartbeat",
        targetThreadId,
      });

      const { run } = yield* service.runNow({ automationId: created.id });

      assert.strictEqual(dispatchedCommands.length, 1);
      const command = dispatchedCommands[0];
      assert.strictEqual(command?.type, "thread.turn.start");
      if (command?.type !== "thread.turn.start") {
        assert.fail("Expected a thread.turn.start command.");
      }
      assert.strictEqual(command.threadId, targetThreadId);
      assert.isUndefined(dispatchedCommands.find((entry) => entry.type === "thread.create"));
      assert.strictEqual(run.threadId, targetThreadId);
      assert.strictEqual(run.status, "running");
    }),
  );

  it.effect("does not complete a queued heartbeat run from an unrelated latest turn", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const projectionTurns = yield* ProjectionTurnRepository;
      const targetThreadId = ThreadId.makeUnsafe("heartbeat-queued-thread");
      const unrelatedTurnId = TurnId.makeUnsafe("turn-unrelated");
      const automationTurnId = TurnId.makeUnsafe("turn-automation");
      threadShell = Option.some(makeThreadShell({ id: targetThreadId }));

      const created = yield* service.create({
        ...createInput("local"),
        mode: "heartbeat",
        targetThreadId,
      });
      const { run } = yield* service.runNow({ automationId: created.id });
      assert.isNotNull(run.messageId);

      threadShell = Option.some(
        makeThreadShell({
          id: targetThreadId,
          latestTurn: makeLatestTurn("completed", unrelatedTurnId),
        }),
      );
      yield* service.reconcileThread({ threadId: targetThreadId });

      const queued = yield* service.list({ projectId });
      assert.strictEqual(queued.runs.find((entry) => entry.id === run.id)?.status, "running");

      yield* projectionTurns.upsertByTurnId({
        threadId: targetThreadId,
        turnId: automationTurnId,
        pendingMessageId: run.messageId,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        assistantMessageId: null,
        state: "completed",
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
      });
      threadShell = Option.some(
        makeThreadShell({
          id: targetThreadId,
          latestTurn: makeLatestTurn("completed", automationTurnId),
        }),
      );
      yield* service.reconcileThread({ threadId: targetThreadId });

      const reconciled = yield* service.list({ projectId });
      const updated = reconciled.runs.find((entry) => entry.id === run.id);
      assert.strictEqual(updated?.status, "succeeded");
      assert.strictEqual(updated?.turnId, automationTurnId);
    }),
  );

  it.effect("disables a standalone automation when the AI stop condition matches", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const automationTurnId = TurnId.makeUnsafe("turn-standalone-stop");
      completionEvaluation = {
        stopMatched: true,
        confidence: 0.94,
        reason: "The assistant reports the PR is merged.",
      };

      const created = yield* service.create({
        ...createInput("local"),
        mode: "standalone",
        completionPolicy: aiCompletionPolicy("the PR is merged"),
      });

      assert.deepStrictEqual(created.completionPolicy, aiCompletionPolicy("the PR is merged"));

      const { run } = yield* service.runNow({ automationId: created.id });
      const runThreadId = run.threadId;
      assert.isNotNull(runThreadId);
      yield* completeAutomationRun({
        run,
        threadId: runThreadId!,
        turnId: automationTurnId,
        assistantText: "The PR is merged, nothing left to watch.",
      });

      yield* service.reconcileThread({ threadId: runThreadId! });

      const listed = yield* waitForAutomationList({
        service,
        description: "matched standalone stop evaluation",
        predicate: (listed) =>
          listed.definitions.find((entry) => entry.id === created.id)?.enabled === false &&
          listed.runs.find((entry) => entry.id === run.id)?.result?.completionEvaluation
            ?.stopMatched === true,
      });
      const updatedDefinition = listed.definitions.find((entry) => entry.id === created.id);
      const updatedRun = listed.runs.find((entry) => entry.id === run.id);
      assert.strictEqual(updatedDefinition?.enabled, false);
      assert.strictEqual(updatedRun?.result?.completionEvaluation?.stopMatched, true);
      assert.include(updatedRun?.result?.summary ?? "", "Stopped:");
    }),
  );

  it.effect("records a stale stop check when the policy changes during a hung evaluation", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const targetThreadId = ThreadId.makeUnsafe("heartbeat-stop-timeout-stale");
      const automationTurnId = TurnId.makeUnsafe("turn-stop-timeout-stale");
      threadShell = Option.some(makeThreadShell({ id: targetThreadId }));
      completionEvaluation = {
        stopMatched: true,
        confidence: 0.99,
        reason: "Should never be read because the evaluation hangs.",
      };
      const evaluationGate = holdCompletionEvaluation();

      const created = yield* service.create({
        ...createInput("local"),
        mode: "heartbeat",
        targetThreadId,
        completionPolicy: aiCompletionPolicy("the PR is ready"),
      });
      const { run } = yield* service.runNow({ automationId: created.id });
      yield* completeAutomationRun({
        run,
        threadId: targetThreadId,
        turnId: automationTurnId,
        assistantText: "Still working through the review.",
      });

      yield* service.reconcileThread({ threadId: targetThreadId });
      yield* waitForPromise({
        promise: evaluationGate.started,
        timeoutMs: 1_000,
        description: "hung stop evaluation to start",
      });

      yield* service.update({ id: created.id, completionPolicy: { type: "none" } });

      yield* TestClock.adjust(Duration.seconds(31));

      const listed = yield* waitForAutomationList({
        service,
        description: "stale timed-out stop evaluation",
        predicate: (current) =>
          current.runs.find((entry) => entry.id === run.id)?.result?.completionEvaluation
            ?.reason ===
          "Stop check ignored because the automation changed before evaluation finished.",
      });
      const updatedRun = listed.runs.find((entry) => entry.id === run.id);
      assert.strictEqual(updatedRun?.result?.completionEvaluation?.stopMatched, false);
      assert.notInclude((updatedRun?.result?.summary ?? "").toLowerCase(), "timed out");

      evaluationGate.release();
    }),
  );

  it.effect("ignores a matched stop evaluation when the automation changes while pending", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const targetThreadId = ThreadId.makeUnsafe("heartbeat-stop-stale-definition");
      const automationTurnId = TurnId.makeUnsafe("turn-stop-stale-definition");
      threadShell = Option.some(makeThreadShell({ id: targetThreadId }));
      completionEvaluation = {
        stopMatched: true,
        confidence: 0.98,
        reason: "The old automation definition matched.",
      };
      const evaluationGate = holdCompletionEvaluation();

      const created = yield* service.create({
        ...createInput("local"),
        mode: "heartbeat",
        targetThreadId,
        completionPolicy: aiCompletionPolicy("the PR is ready"),
      });
      const { run } = yield* service.runNow({ automationId: created.id });
      yield* completeAutomationRun({
        run,
        threadId: targetThreadId,
        turnId: automationTurnId,
        assistantText: "The PR is ready.",
      });

      yield* service.reconcileThread({ threadId: targetThreadId });
      yield* waitForPromise({
        promise: evaluationGate.started,
        timeoutMs: 1_000,
        description: "stale-definition stop evaluation to start",
      });
      const beforeEdit = yield* service.list({ projectId });
      const queuedDefinition = beforeEdit.definitions.find((entry) => entry.id === created.id);
      yield* realDelay(5);
      let edited = yield* service.update({
        id: created.id,
        name: "Retitled heartbeat monitor",
      });
      if (edited.updatedAt === queuedDefinition?.updatedAt) {
        yield* realDelay(5);
        edited = yield* service.update({
          id: created.id,
          name: "Retitled heartbeat monitor again",
        });
      }
      evaluationGate.release();

      const listed = yield* waitForAutomationList({
        service,
        description: "stale-definition stop evaluation",
        predicate: (listed) =>
          listed.runs.find((entry) => entry.id === run.id)?.result?.completionEvaluation?.reason ===
          "Stop check ignored because the automation changed before evaluation finished.",
      });
      const updatedDefinition = listed.definitions.find((entry) => entry.id === created.id);
      const updatedRun = listed.runs.find((entry) => entry.id === run.id);
      assert.notStrictEqual(edited.updatedAt, queuedDefinition?.updatedAt);
      assert.strictEqual(updatedDefinition?.enabled, true);
      assert.strictEqual(updatedDefinition?.name, edited.name);
      assert.deepStrictEqual(
        updatedDefinition?.completionPolicy,
        aiCompletionPolicy("the PR is ready"),
      );
      assert.strictEqual(updatedRun?.result?.completionEvaluation?.stopMatched, false);
      assert.notInclude(updatedRun?.result?.summary ?? "", "Stopped:");
    }),
  );

  it.effect("keeps a heartbeat automation active when the stop match is low confidence", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const targetThreadId = ThreadId.makeUnsafe("heartbeat-stop-ambiguous");
      const automationTurnId = TurnId.makeUnsafe("turn-stop-ambiguous");
      threadShell = Option.some(makeThreadShell({ id: targetThreadId }));
      completionEvaluation = {
        stopMatched: true,
        confidence: 0.52,
        reason: "The assistant was uncertain whether the PR is ready.",
      };

      const created = yield* service.create({
        ...createInput("local"),
        mode: "heartbeat",
        targetThreadId,
        completionPolicy: aiCompletionPolicy("the PR is ready"),
      });
      const { run } = yield* service.runNow({ automationId: created.id });
      yield* completeAutomationRun({
        run,
        threadId: targetThreadId,
        turnId: automationTurnId,
        assistantText: "It may be ready, but one signal is unclear.",
      });

      yield* service.reconcileThread({ threadId: targetThreadId });

      const listed = yield* waitForAutomationList({
        service,
        description: "low-confidence stop evaluation",
        predicate: (listed) =>
          listed.runs.find((entry) => entry.id === run.id)?.result?.completionEvaluation
            ?.confidence === 0.52,
      });
      const updatedRun = listed.runs.find((entry) => entry.id === run.id);
      assert.strictEqual(
        listed.definitions.find((entry) => entry.id === created.id)?.enabled,
        true,
      );
      assert.strictEqual(updatedRun?.result?.completionEvaluation?.stopMatched, true);
      assert.strictEqual(updatedRun?.result?.completionEvaluation?.confidence, 0.52);
      assert.strictEqual(
        updatedRun?.result?.summary,
        "The assistant was uncertain whether the PR is ready.",
      );
    }),
  );

  it.effect(
    "keeps a heartbeat automation active and records history when stop evaluation fails",
    () =>
      Effect.gen(function* () {
        resetHarness();
        const service = yield* AutomationService;
        const targetThreadId = ThreadId.makeUnsafe("heartbeat-stop-evaluator-failure");
        const automationTurnId = TurnId.makeUnsafe("turn-stop-evaluator-failure");
        threadShell = Option.some(makeThreadShell({ id: targetThreadId }));
        completionEvaluationFailure = new Error("provider unavailable");

        const created = yield* service.create({
          ...createInput("local"),
          mode: "heartbeat",
          targetThreadId,
          completionPolicy: aiCompletionPolicy("the PR is ready"),
        });
        const { run } = yield* service.runNow({ automationId: created.id });
        yield* completeAutomationRun({
          run,
          threadId: targetThreadId,
          turnId: automationTurnId,
        });

        yield* service.reconcileThread({ threadId: targetThreadId });

        const listed = yield* waitForAutomationList({
          service,
          description: "failed stop evaluation",
          predicate: (listed) =>
            listed.runs.find((entry) => entry.id === run.id)?.result?.completionEvaluation
              ?.confidence === 0,
        });
        const updatedRun = listed.runs.find((entry) => entry.id === run.id);
        assert.strictEqual(
          listed.definitions.find((entry) => entry.id === created.id)?.enabled,
          true,
        );
        assert.strictEqual(updatedRun?.result?.completionEvaluation?.stopMatched, false);
        assert.strictEqual(updatedRun?.result?.completionEvaluation?.confidence, 0);
        assert.include(updatedRun?.result?.summary ?? "", "Stop check failed:");
        assert.include(
          updatedRun?.result?.completionEvaluation?.reason ?? "",
          "Stop check failed:",
        );
      }),
  );

  it.effect("rejects custom schedules faster than the configured minimum interval", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;

      const error = yield* service
        .create({
          ...createInput("local"),
          schedule: { type: "cron", expression: "* * * * *", timezone: "UTC" },
          minimumIntervalSeconds: 120,
        })
        .pipe(Effect.flip);

      assert.match(error.message, /120 seconds apart/);
    }),
  );

  it.effect("rejects updates that remove the hard cap from fast recurring intervals", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const created = yield* service.create({
        ...createInput("local"),
        schedule: { type: "interval", everySeconds: 15 },
        maxIterations: 3,
        acknowledgedRisks: ["fast-interval", "local-checkout"],
      });

      const error = yield* service
        .update({ id: created.id, maxIterations: null })
        .pipe(Effect.flip);

      assert.match(error.message, /max iterations.*10 runs or fewer/);
    }),
  );

  it.effect("rejects unacknowledged fast recurring intervals", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;

      const error = yield* service
        .create({
          ...createInput("local"),
          schedule: { type: "interval", everySeconds: 15 },
        })
        .pipe(Effect.flip);

      assert.match(error.message, /60 seconds apart/);
    }),
  );

  it.effect("rejects unacknowledged full-access automations", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;

      const error = yield* service
        .create({
          ...createInput("worktree"),
          runtimeMode: "full-access",
        })
        .pipe(Effect.flip);

      assert.match(error.message, /full-access/);
    }),
  );

  it.effect("disables a scheduled automation that has reached its iteration cap", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.makeUnsafe("automation-max-iters");

      yield* repository.createDefinition({
        id: automationId,
        input: {
          ...createInput("local"),
          schedule: { type: "interval", everySeconds: 300 },
          maxIterations: 1,
        },
        now: "2026-06-16T10:00:00.000Z",
      });

      yield* repository.incrementDefinitionIterationCount({
        id: automationId,
        now: "2026-06-16T10:00:00.000Z",
      });

      const results = yield* service.runDueOnce({
        now: "2026-06-16T10:00:00.000Z",
        limit: 10,
        leaseOwnerId: "test-scheduler",
      });

      assert.strictEqual(results.length, 0);
      assert.strictEqual(dispatchedCommands.length, 0);
      const reloaded = yield* service.list({ projectId });
      const definition = reloaded.definitions.find((entry) => entry.id === automationId);
      assert.strictEqual(definition?.enabled, false);

      assert.strictEqual(
        reloaded.runs.filter((entry) => entry.automationId === automationId).length,
        0,
      );
    }),
  );

  it.effect("dispatches at most three due automations in parallel per scheduler pass", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const scheduledAt = "2000-01-01T10:00:00.000Z";
      let activeDispatches = 0;
      let maximumDispatches = 0;
      dispatchHook = (command) =>
        command.type !== "thread.create"
          ? Effect.void
          : Effect.sync(() => {
              activeDispatches += 1;
              maximumDispatches = Math.max(maximumDispatches, activeDispatches);
            }).pipe(
              Effect.andThen(realDelay(25)),
              Effect.ensuring(
                Effect.sync(() => {
                  activeDispatches -= 1;
                }),
              ),
            );
      yield* Effect.forEach(
        [1, 2, 3, 4],
        (index) =>
          repository.createDefinition({
            id: AutomationId.makeUnsafe(`automation-parallel-${index}`),
            input: {
              ...createInput("local"),
              name: `Parallel ${index}`,
              schedule: { type: "interval", everySeconds: 300 },
            },
            now: scheduledAt,
          }),
        { discard: true },
      );

      const results = yield* service.runDueOnce({
        now: scheduledAt,
        limit: 3,
        leaseOwnerId: "test-scheduler",
      });

      assert.lengthOf(results, 3);
      assert.strictEqual(maximumDispatches, 3);
      assert.lengthOf(
        dispatchedCommands.filter((command) => command.type === "thread.turn.start"),
        3,
      );
      const listed = yield* service.list({ projectId });
      assert.lengthOf(
        listed.definitions.filter(
          (definition) =>
            definition.id.startsWith("automation-parallel-") &&
            definition.nextRunAt === scheduledAt,
        ),
        1,
      );
      yield* Effect.forEach(
        listed.definitions.filter((definition) => definition.id.startsWith("automation-parallel-")),
        (definition) =>
          repository.disableDefinition({
            id: definition.id,
            now: scheduledAt,
            reason: "user",
          }),
        { discard: true },
      );
    }),
  );

  it.effect("keeps running below a three-failure threshold and disables on the third failure", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const created = yield* service.create({
        ...createInput("local"),
        stopAfterConsecutiveFailures: 3,
      });

      for (let failureNumber = 1; failureNumber <= 3; failureNumber += 1) {
        const { run } = yield* service.runNow({ automationId: created.id });
        yield* reconcileAutomationRun({
          service,
          run,
          state: "error",
          error: `failure ${failureNumber}`,
        });

        const definition = (yield* service.list({ projectId })).definitions.find(
          (entry) => entry.id === created.id,
        );
        assert.strictEqual(definition?.consecutiveFailureCount, failureNumber);
        assert.strictEqual(definition?.enabled, failureNumber < 3);
      }

      const stopped = (yield* service.list({ projectId })).definitions.find(
        (entry) => entry.id === created.id,
      );
      assert.strictEqual(stopped?.disabledReason, "failures");
      assert.isNotNull(stopped?.disabledAt ?? null);
    }),
  );

  it.effect("disables a bounded automation when its final iteration fails", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const created = yield* service.create({
        ...createInput("local"),
        maxIterations: 1,
        stopAfterConsecutiveFailures: 3,
      });
      const { run } = yield* service.runNow({ automationId: created.id });

      yield* reconcileAutomationRun({
        service,
        run,
        state: "error",
        error: "final iteration failed",
      });

      const definition = (yield* service.list({ projectId })).definitions.find(
        (entry) => entry.id === created.id,
      );
      assert.isFalse(definition?.enabled ?? true);
      assert.strictEqual(definition?.disabledReason, "max-iterations");
      assert.strictEqual(definition?.consecutiveFailureCount, 1);
    }),
  );

  it.effect("defers a due heartbeat run while the target thread is in flight", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.makeUnsafe("automation-in-flight");
      const targetThreadId = ThreadId.makeUnsafe("thread-in-flight-target");
      threadShell = Option.some(makeThreadShell({ id: targetThreadId }));

      yield* repository.createDefinition({
        id: automationId,
        input: {
          ...createInput("local"),
          schedule: { type: "interval", everySeconds: 300 },
          mode: "heartbeat",
          targetThreadId,
        },
        now: "2026-06-16T10:00:00.000Z",
      });

      const first = yield* service.runDueOnce({
        now: "2026-06-16T10:00:00.000Z",
        limit: 10,
        leaseOwnerId: "test-scheduler",
      });
      const firstForAutomation = first.filter((entry) => entry.run.automationId === automationId);
      assert.strictEqual(firstForAutomation.length, 1);
      const activeRun = firstForAutomation[0]!.run;
      const targetThreadDispatchCount = () =>
        dispatchedCommands.filter(
          (command) => command.type === "thread.turn.start" && command.threadId === targetThreadId,
        ).length;
      const dispatchedBefore = targetThreadDispatchCount();
      assert.strictEqual(dispatchedBefore, 1);
      assert.strictEqual(
        yield* repository.countActiveRunsForThread({ threadId: targetThreadId }),
        1,
      );

      const second = yield* service.runDueOnce({
        now: "2026-06-16T10:05:00.000Z",
        limit: 10,
        leaseOwnerId: "test-scheduler",
      });

      const secondForAutomation = second.filter((entry) => entry.run.automationId === automationId);
      assert.strictEqual(secondForAutomation.length, 1);
      const deferredRun = secondForAutomation[0]!.run;
      assert.strictEqual(deferredRun.status, "pending");
      assert.isNotNull(deferredRun.deferredUntil);
      assert.strictEqual(targetThreadDispatchCount(), dispatchedBefore);
      const reloaded = yield* service.list({ projectId });
      const definition = reloaded.definitions.find((entry) => entry.id === automationId);
      assert.strictEqual(definition?.nextRunAt, "2026-06-16T10:10:00.000Z");
      const runs = reloaded.runs.filter((entry) => entry.automationId === automationId);
      assert.strictEqual(runs.length, 2);
      assert.strictEqual(runs.find((entry) => entry.id === deferredRun.id)?.status, "pending");

      const projectionTurns = yield* ProjectionTurnRepository;
      yield* projectionTurns.upsertByTurnId({
        threadId: targetThreadId,
        turnId: TurnId.makeUnsafe("turn-in-flight-complete"),
        pendingMessageId: activeRun.messageId,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        assistantMessageId: null,
        state: "completed",
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
      });
      threadShell = Option.some(
        makeThreadShell({
          id: targetThreadId,
          latestTurn: makeLatestTurn("completed", TurnId.makeUnsafe("turn-in-flight-complete")),
        }),
      );
      yield* service.reconcileThread({ threadId: targetThreadId });

      const reconciled = yield* service.list({ projectId });
      assert.strictEqual(
        reconciled.runs.find((entry) => entry.id === activeRun.id)?.status,
        "succeeded",
      );
      assert.strictEqual(
        yield* repository.countActiveRunsForThread({ threadId: targetThreadId }),
        0,
      );
      yield* service.cancelRun({ runId: deferredRun.id });
      yield* repository.disableDefinition({
        id: automationId,
        now: "2026-06-16T10:05:00.000Z",
        reason: "user",
      });
    }),
  );

  it.effect("dispatches only one concurrently due heartbeat for a shared target", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const targetThreadId = ThreadId.makeUnsafe("shared-heartbeat-target");
      threadShell = Option.some(
        makeThreadShell({
          id: targetThreadId,
          latestTurn: makeLatestTurn("running", TurnId.makeUnsafe("shared-heartbeat-active-turn")),
        }),
      );
      const definitions = yield* Effect.forEach(["A", "B"], (suffix) =>
        service.create({
          ...createInput("local"),
          name: `Shared heartbeat ${suffix}`,
          mode: "heartbeat",
          targetThreadId,
        }),
      );
      const deferredRuns = yield* Effect.forEach(definitions, (definition) =>
        service.runNow({ automationId: definition.id }).pipe(Effect.map((result) => result.run)),
      );
      const retryAt = deferredRuns
        .map((run) => run.deferredUntil)
        .filter((value): value is string => value !== null)
        .toSorted()
        .at(-1);
      assert.isDefined(retryAt);
      threadShell = Option.some(makeThreadShell({ id: targetThreadId }));

      yield* service.runDueOnce({
        now: retryAt!,
        limit: 3,
        leaseOwnerId: "test-scheduler",
      });

      const reloaded = (yield* service.list({ projectId })).runs.filter((run) =>
        definitions.some((definition) => definition.id === run.automationId),
      );
      assert.strictEqual(
        dispatchedCommands.filter(
          (command) => command.type === "thread.turn.start" && command.threadId === targetThreadId,
        ).length,
        1,
      );
      assert.strictEqual(reloaded.filter((run) => run.status === "running").length, 1);
      assert.strictEqual(
        reloaded.filter((run) => run.status === "pending" && run.deferredUntil !== null).length,
        1,
      );
    }),
  );

  it.effect("records a failed run and still advances the schedule when dispatch fails", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.makeUnsafe("automation-dispatch-fail");

      yield* repository.createDefinition({
        id: automationId,
        input: {
          ...createInput("local"),
          schedule: { type: "interval", everySeconds: 300 },

          stopAfterConsecutiveFailures: null,
        },
        now: "2026-06-16T10:00:00.000Z",
      });

      failDispatchType = "thread.create";
      const results = yield* service.runDueOnce({
        now: "2026-06-16T10:00:00.000Z",
        limit: 10,
        leaseOwnerId: "test-scheduler",
      });

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]?.run.status, "failed");

      const reloaded = yield* service.list({ projectId });
      const runs = reloaded.runs.filter((entry) => entry.automationId === automationId);
      assert.strictEqual(runs.length, 1);
      assert.strictEqual(runs[0]?.status, "failed");

      const definition = reloaded.definitions.find((entry) => entry.id === automationId);
      assert.strictEqual(definition?.nextRunAt, "2026-06-16T10:05:00.000Z");
    }),
  );

  it.effect(
    "does not re-dispatch or double-count an occurrence whose run was interrupted before the schedule advanced",
    () =>
      Effect.gen(function* () {
        resetHarness();
        const service = yield* AutomationService;
        const repository = yield* AutomationRepository;
        const automationId = AutomationId.makeUnsafe("automation-crash-replay");
        const scheduledFor = "2026-06-16T10:00:00.000Z";

        yield* repository.createDefinition({
          id: automationId,
          input: {
            ...createInput("local"),
            schedule: { type: "interval", everySeconds: 300 },
          },
          now: scheduledFor,
        });

        const crashed = yield* repository.createRun({
          id: AutomationRunId.makeUnsafe("run-crashed"),
          automationId,
          projectId,
          threadId: null,
          trigger: { type: "scheduled" },
          scheduledFor,
          permissionSnapshot: {
            provider: "codex",
            modelSelection: { provider: "codex", model: "gpt-5-codex" },
            runtimeMode: "approval-required",
            interactionMode: "default",
            worktreeMode: "local",
            allowedCapabilities: ["send-turn"],
            createdAt: scheduledFor,
          },
          now: scheduledFor,
        });
        yield* repository.markRunInterrupted({
          id: crashed.id,
          turnId: null,
          finishedAt: scheduledFor,
        });

        const results = yield* service.runDueOnce({
          now: scheduledFor,
          limit: 10,
          leaseOwnerId: "test-scheduler",
        });

        assert.strictEqual(results.length, 0);
        assert.strictEqual(dispatchedCommands.length, 0);
        const reloaded = yield* service.list({ projectId });
        const definition = reloaded.definitions.find((entry) => entry.id === automationId);

        assert.strictEqual(definition?.nextRunAt, "2026-06-16T10:05:00.000Z");

        assert.strictEqual(definition?.iterationCount, 0);
        assert.strictEqual(
          reloaded.runs.filter((entry) => entry.automationId === automationId).length,
          1,
        );
        assert.strictEqual(
          reloaded.runs.find((entry) => entry.id === crashed.id)?.status,
          "interrupted",
        );
      }),
  );

  it.effect("deleting an automation cancels and interrupts its active runs", () =>
    Effect.gen(function* () {
      resetHarness();
      const service = yield* AutomationService;

      const created = yield* service.create(createInput("local"));
      const { run } = yield* service.runNow({ automationId: created.id });
      const threadId = run.threadId!;

      yield* service.delete({ id: created.id });

      const reloaded = yield* service.list({ projectId, includeArchived: true });
      const definition = reloaded.definitions.find((entry) => entry.id === created.id);
      assert.isNotNull(definition?.archivedAt ?? null);
      assert.strictEqual(reloaded.runs.find((entry) => entry.id === run.id)?.status, "cancelled");
      assert.isDefined(
        dispatchedCommands.find(
          (command) => command.type === "thread.turn.interrupt" && command.threadId === threadId,
        ),
      );
    }),
  );
});
