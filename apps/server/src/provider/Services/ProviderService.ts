import type { ClaudeCacheObservation } from "@glade/contracts/provider/claudeCache";
import type {
  ProviderBackgroundTaskInput,
  ProviderForkThreadInput,
  ProviderForkThreadResult,
  ProviderInterruptTurnInput,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderSendTurnInput,
  ProviderStartReviewInput,
  ProviderSteerTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderSteerSubagentInput,
  ProviderStopSessionInput,
  ProviderStopTaskInput,
  ProviderTurnStartResult,
} from "@glade/contracts/provider/provider";
import type { ProviderKind, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type {
  ModelSelection,
  RuntimeMode,
  ProviderStartOptions,
} from "@glade/contracts/provider/sessionPolicy";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type { ProviderServiceError } from "../core/Errors.ts";
import type { PersistedProviderRuntimeEvent } from "../../persistence/Services/ProviderRuntimeEvents.ts";
import type { ProviderAdapterCapabilities } from "./ProviderAdapter.ts";

export type ProviderRuntimeEventPumpStatus = "starting" | "healthy" | "recovering" | "degraded";

export interface ProviderRuntimeEventPumpHealth {
  readonly provider: ProviderKind;
  readonly status: ProviderRuntimeEventPumpStatus;
  readonly consecutiveFailures: number;
  readonly updatedAt: string;
  readonly lastEventAt?: string;
  readonly lastError?: string;
  readonly quarantinedEvents?: number;
  readonly lastQuarantinedEventId?: string;
  readonly lastQuarantinedAt?: string;
}

interface ProviderSessionStartOutcome {
  readonly session: ProviderSession;
  readonly nativeResumeAttempted: boolean;
  readonly nativeResumeSucceeded: boolean;
  readonly priorTranscriptBootstrapPending: boolean;
}

interface ProviderSessionStartOutcomeOptions {
  readonly registerPriorTranscriptBootstrapOnFreshStart?: boolean;
}

export interface ProviderServiceShape {
  readonly startClaudeCompaction?: (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
  }) => Effect.Effect<ProviderTurnStartResult, ProviderServiceError>;
  readonly getClaudeCacheObservation?: (
    threadId: ThreadId,
  ) => Effect.Effect<ClaudeCacheObservation | undefined, ProviderServiceError>;

  readonly startSession: (
    threadId: ThreadId,
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, ProviderServiceError>;

  readonly startSessionWithOutcome?: (
    threadId: ThreadId,
    input: ProviderSessionStartInput,
    options?: ProviderSessionStartOutcomeOptions,
  ) => Effect.Effect<ProviderSessionStartOutcome, ProviderServiceError>;

  readonly completePriorTranscriptBootstrap?: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<void, ProviderServiceError>;

  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, ProviderServiceError>;

  readonly steerTurn: (
    input: ProviderSteerTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, ProviderServiceError>;

  readonly startReview: (
    input: ProviderStartReviewInput,
  ) => Effect.Effect<ProviderTurnStartResult, ProviderServiceError>;

  // Returns a persisted provider-native fork binding when available, otherwise `null` so callers can
  // fall back to orchestration-only history.
  readonly forkThread?: (
    input: ProviderForkThreadInput,
  ) => Effect.Effect<ProviderForkThreadResult | null, ProviderServiceError>;

  readonly importExternalThread?: (input: {
    readonly threadId: ThreadId;
    readonly provider: "codex" | "claudeAgent";
    readonly externalThreadId: string;
    readonly sourceCwd: string;
    readonly cwd?: string;
    readonly modelSelection: ModelSelection;
    readonly providerOptions?: ProviderStartOptions;
    readonly runtimeMode: RuntimeMode;
  }) => Effect.Effect<ProviderForkThreadResult, ProviderServiceError>;

  readonly interruptTurn: (
    input: ProviderInterruptTurnInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  readonly stopTask: (input: ProviderStopTaskInput) => Effect.Effect<void, ProviderServiceError>;

  readonly backgroundTask: (
    input: ProviderBackgroundTaskInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  readonly steerSubagent: (
    input: ProviderSteerSubagentInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  readonly respondToRequest: (
    input: ProviderRespondToRequestInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  readonly respondToUserInput: (
    input: ProviderRespondToUserInputInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  readonly stopSession: (
    input: ProviderStopSessionInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  readonly stopRuntimeSession?: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<void, ProviderServiceError>;

  readonly hasLiveRuntimeTasks?: (input: { readonly threadId: ThreadId }) => Effect.Effect<boolean>;

  readonly clearSessionResumeCursor?: (input: {
    readonly threadId: ThreadId;

    readonly preserveActiveRuntime?: boolean;
  }) => Effect.Effect<void, ProviderServiceError>;

  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  readonly getCapabilities: (
    provider: ProviderKind,
  ) => Effect.Effect<ProviderAdapterCapabilities, ProviderServiceError>;

  readonly rollbackConversation: (input: {
    readonly threadId: ThreadId;
    readonly numTurns: number;
  }) => Effect.Effect<void, ProviderServiceError>;

  readonly compactThread: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<void, ProviderServiceError>;

  readonly closeRuntimeEvents: Effect.Effect<void>;

  readonly getRuntimeEventPumpHealth?: () => Effect.Effect<
    ReadonlyArray<ProviderRuntimeEventPumpHealth>
  >;

  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;

  readonly streamPersistedEvents?: Stream.Stream<PersistedProviderRuntimeEvent>;
}

export class ProviderService extends ServiceMap.Service<ProviderService, ProviderServiceShape>()(
  "glade/provider/Services/ProviderService",
) {}
