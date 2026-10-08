import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import type { ThreadTitleGenerationShape } from "../Services/ThreadTitleGeneration";
import type { ProviderCommandReactorShape } from "../Services/ProviderCommandReactor";
import type { OrchestrationEventDeliveryRepositoryShape } from "../../persistence/Services/OrchestrationEventDeliveries";
import type { ProviderRuntimeEventRepositoryShape } from "../../persistence/Services/ProviderRuntimeEvents";
import type { QueuedTurnPromotionRepositoryShape } from "../../persistence/Services/QueuedTurnPromotions";

import type { TurnId, ThreadId, MessageId } from "@glade/contracts/core/baseSchemas";
import type { Effect, ServiceMap } from "effect";
import type { HandoffTransitions } from "../Services/HandoffTransitions";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import type { Mock } from "vitest";
import type { CheckpointStoreShape } from "../../checkpointing/Services/CheckpointStore.ts";
import type { ProviderSession } from "@glade/contracts/provider/provider";
import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationDispatchError } from "../Errors.ts";

export interface ReactorTestHarness {
  readonly engine: OrchestrationEngineShape;
  readonly handoffTransitions: ServiceMap.Service.Shape<typeof HandoffTransitions> | undefined;
  readonly reactor: ProviderCommandReactorShape;
  readonly startSession: Mock<NonNullable<ProviderServiceShape["startSession"]>>;
  readonly startSessionWithOutcome: Mock<
    NonNullable<ProviderServiceShape["startSessionWithOutcome"]>
  >;
  readonly listSessions: Mock<NonNullable<ProviderServiceShape["listSessions"]>>;
  readonly sendTurn: Mock<NonNullable<ProviderServiceShape["sendTurn"]>>;
  readonly steerTurn: Mock<
    (_: unknown) => Effect.Effect<{ threadId: ThreadId; turnId: TurnId }, never, never>
  >;
  readonly interruptTurn: Mock<ProviderServiceShape["interruptTurn"]>;
  readonly rollbackConversation: Mock<NonNullable<ProviderServiceShape["rollbackConversation"]>>;
  readonly isGitRepository: Mock<CheckpointStoreShape["isGitRepository"]>;
  readonly restoreScopedCheckpoint: Mock<CheckpointStoreShape["restoreScopedCheckpoint"]>;
  readonly stopSession: Mock<(input: unknown) => Effect.Effect<void, never, never>>;
  readonly stopRuntimeSession: Mock<(input: unknown) => Effect.Effect<void, never, never>>;
  readonly clearSessionResumeCursor: Mock<
    NonNullable<ProviderServiceShape["clearSessionResumeCursor"]>
  >;
  readonly generateTitle: Mock<ThreadTitleGenerationShape["generate"]>;
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
  readonly runtimeEventRepository: ProviderRuntimeEventRepositoryShape;
  readonly queuedTurnPromotionRepository: QueuedTurnPromotionRepositoryShape;
  readonly interceptEngineDispatch: (
    interceptor: (
      command: OrchestrationCommand,
    ) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError> | undefined,
  ) => void;
}
