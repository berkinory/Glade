import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import type { ThreadTitleGenerationShape } from "../Services/ThreadTitleGeneration";
import type { ProviderCommandReactorShape } from "../Services/ProviderCommandReactor";
import type { ServerSettingsShape } from "../../settings/serverSettings";
import type { OrchestrationEventDeliveryRepositoryShape } from "../../persistence/Services/OrchestrationEventDeliveries";
import type { ProjectionPendingInteractionRepositoryShape } from "../../persistence/Services/ProjectionPendingInteractions";
import type { ProviderRuntimeEventRepositoryShape } from "../../persistence/Services/ProviderRuntimeEvents";
import type { QueuedTurnPromotionRepositoryShape } from "../../persistence/Services/QueuedTurnPromotions";
import type { AgentGatewayOperationRepositoryShape } from "../../agentGateway/Services/AgentGatewayOperationRepository";

import type { TurnId, ThreadId, MessageId } from "@glade/contracts/core/baseSchemas";
import type { Effect, ServiceMap } from "effect";
import type { HandoffTransitions } from "../Services/HandoffTransitions";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import type { Mock } from "vitest";
import type { CheckpointStoreShape } from "../../checkpointing/Services/CheckpointStore.ts";
import type { ProviderSession } from "@glade/contracts/provider/provider";
import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { TextGenerationShape } from "../../git/Services/TextGeneration.ts";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationDispatchError } from "../Errors.ts";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";

export interface ReactorTestHarness {
  readonly engine: OrchestrationEngineShape;
  readonly handoffTransitions: ServiceMap.Service.Shape<typeof HandoffTransitions> | undefined;
  readonly seedCompletion: () => Promise<readonly Record<string, unknown>[]>;
  readonly completionState: () => Promise<
    readonly { context_consumed: number; context_event_sequence: number | null }[]
  >;
  readonly reactor: ProviderCommandReactorShape;
  readonly serverSettings: ServerSettingsShape;
  readonly startSession: Mock<NonNullable<ProviderServiceShape["startSession"]>>;
  readonly startSessionWithOutcome: Mock<
    NonNullable<ProviderServiceShape["startSessionWithOutcome"]>
  >;
  readonly completePriorTranscriptBootstrap: Mock<
    NonNullable<ProviderServiceShape["completePriorTranscriptBootstrap"]>
  >;
  readonly pendingPriorTranscriptBootstraps: Set<ThreadId>;
  readonly listSessions: Mock<NonNullable<ProviderServiceShape["listSessions"]>>;
  readonly sendTurn: Mock<NonNullable<ProviderServiceShape["sendTurn"]>>;
  readonly steerTurn: Mock<
    (_: unknown) => Effect.Effect<{ threadId: ThreadId; turnId: TurnId }, never, never>
  >;
  readonly startReview: Mock<NonNullable<ProviderServiceShape["startReview"]>>;
  readonly forkThread: Mock<NonNullable<ProviderServiceShape["forkThread"]>>;
  readonly interruptTurn: Mock<ProviderServiceShape["interruptTurn"]>;
  readonly stopTask: Mock<NonNullable<ProviderServiceShape["stopTask"]>>;
  readonly backgroundTask: Mock<NonNullable<ProviderServiceShape["backgroundTask"]>>;
  readonly hasLiveRuntimeTasks: Mock<NonNullable<ProviderServiceShape["hasLiveRuntimeTasks"]>>;
  readonly steerSubagent: Mock<NonNullable<ProviderServiceShape["steerSubagent"]>>;
  readonly respondToRequest: Mock<NonNullable<ProviderServiceShape["respondToRequest"]>>;
  readonly respondToUserInput: Mock<NonNullable<ProviderServiceShape["respondToUserInput"]>>;
  readonly rollbackConversation: Mock<NonNullable<ProviderServiceShape["rollbackConversation"]>>;
  readonly isGitRepository: Mock<CheckpointStoreShape["isGitRepository"]>;
  readonly captureCheckpoint: Mock<CheckpointStoreShape["captureCheckpoint"]>;
  readonly restoreScopedCheckpoint: Mock<CheckpointStoreShape["restoreScopedCheckpoint"]>;
  readonly stopSession: Mock<(input: unknown) => Effect.Effect<void, never, never>>;
  readonly stopRuntimeSession: Mock<(input: unknown) => Effect.Effect<void, never, never>>;
  readonly clearSessionResumeCursor: Mock<
    NonNullable<ProviderServiceShape["clearSessionResumeCursor"]>
  >;
  readonly renameBranch: Mock<(input: unknown) => Effect.Effect<{ branch: string }, never, never>>;
  readonly publishBranch: Mock<() => Effect.Effect<void, never, never>>;
  readonly generateTitle: Mock<ThreadTitleGenerationShape["generate"]>;
  readonly generateBranchName: Mock<TextGenerationShape["generateBranchName"]>;
  readonly stateDir: string;
  readonly stageAttachment: (
    attachment: {
      readonly type: "image" | "file";
      readonly id: string;
      readonly name: string;
      readonly mimeType: string;
      readonly sizeBytes: number;
    },
    ownerThreadId?: string,
  ) => Promise<string>;
  readonly readThread: (threadId: ThreadId) => Promise<OrchestrationThread | undefined>;
  readonly seedUserMessage: (input: {
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
    readonly text: string;
    readonly createdAt: string;
  }) => Promise<void>;
  readonly drain: () => Promise<void>;
  readonly emitRuntimeEvent: (event: ProviderRuntimeEvent) => Promise<void>;
  readonly setRuntimeSessionTurnState: (input: {
    readonly threadId: string;
    readonly status: ProviderSession["status"];
    readonly activeTurnId?: TurnId;
  }) => void;
  readonly startReactor: () => Promise<void>;
  readonly deliveryRepository: OrchestrationEventDeliveryRepositoryShape;
  readonly sql: SqlClient.SqlClient;
  readonly pendingInteractionRepository: ProjectionPendingInteractionRepositoryShape;
  readonly runtimeEventRepository: ProviderRuntimeEventRepositoryShape;
  readonly reserveGatewayOperation: (
    operationId: string,
  ) => Promise<Effect.Success<ReturnType<AgentGatewayOperationRepositoryShape["reserve"]>>>;
  readonly markGatewayOperationDispatching: (operationId: string) => Promise<boolean>;
  readonly completeGatewayOperation: (operationId: string) => Promise<void>;
  readonly persistWithoutLivePublication: (
    events: ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
  ) => Promise<OrchestrationEvent[]>;
  readonly persistSessionWithoutLivePublication: (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly updatedAt: string;
  }) => Promise<readonly Record<string, unknown>[]>;
  readonly queuedTurnPromotionRepository: QueuedTurnPromotionRepositoryShape;
  readonly interceptEngineDispatch: (
    interceptor: (
      command: OrchestrationCommand,
    ) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError> | undefined,
  ) => void;
}
