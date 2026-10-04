import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";
import { EventId } from "@glade/contracts/core/baseSchemas";
import {
  CHECKPOINT_REVERT_SUCCEEDED_ACTIVITY_KIND,
  type SpaceAssignmentWorkspacePaths,
} from "../commandInvariants.ts";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import { Effect } from "effect";
import { OrchestrationCommandInvariantError } from "../Errors.ts";

export const nowIso = () => new Date().toISOString();

export const DEFAULT_ASSISTANT_DELIVERY_MODE = "streaming" as const;

const defaultMetadata: Omit<OrchestrationEvent, "sequence" | "type" | "payload"> = {
  eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
  aggregateKind: "thread",
  aggregateId: "" as OrchestrationEvent["aggregateId"],
  occurredAt: nowIso(),
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
};

export function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Omit<OrchestrationEvent, "sequence" | "type" | "payload"> {
  return {
    ...defaultMetadata,
    eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.commandId,
    metadata: input.metadata ?? {},
  };
}

export function userMessageUpsertEvent(input: {
  readonly commandId: OrchestrationCommand["commandId"];
  readonly threadId: OrchestrationThread["id"];
  readonly message: OrchestrationThread["messages"][number];
  readonly turnId: OrchestrationThread["messages"][number]["turnId"];
  readonly startsNewTurn?: boolean;
  readonly occurredAt: string;
}): Omit<OrchestrationEvent, "sequence"> {
  return {
    ...withEventBase({
      aggregateKind: "thread",
      aggregateId: input.threadId,
      occurredAt: input.occurredAt,
      commandId: input.commandId,
    }),
    type: "thread.message-sent",
    payload: {
      threadId: input.threadId,
      messageId: input.message.id,
      role: "user",
      ...(input.message.modelSelection ? { modelSelection: input.message.modelSelection } : {}),
      text: input.message.text,
      ...(input.message.attachments !== undefined
        ? { attachments: input.message.attachments }
        : {}),
      ...(input.message.skills !== undefined ? { skills: input.message.skills } : {}),
      ...(input.message.mentions !== undefined ? { mentions: input.message.mentions } : {}),
      ...(input.message.dispatchMode !== undefined
        ? { dispatchMode: input.message.dispatchMode }
        : {}),
      ...(input.message.dispatchOrigin !== undefined
        ? { dispatchOrigin: input.message.dispatchOrigin }
        : {}),
      ...(input.startsNewTurn !== undefined
        ? { startsNewTurn: input.startsNewTurn }
        : input.message.startsNewTurn !== undefined
          ? { startsNewTurn: input.message.startsNewTurn }
          : {}),
      turnId: input.turnId,
      streaming: false,
      source: input.message.source,
      createdAt: input.message.createdAt,
      updatedAt: input.message.updatedAt,
    },
  };
}

export function checkpointRevertSucceededEvent(input: {
  readonly commandId: OrchestrationCommand["commandId"];
  readonly threadId: Extract<OrchestrationCommand, { type: "thread.revert.complete" }>["threadId"];
  readonly turnCount: number;
  readonly createdAt: string;
  readonly causationEventId: OrchestrationEvent["eventId"];
}): Omit<OrchestrationEvent, "sequence"> {
  return {
    ...withEventBase({
      aggregateKind: "thread",
      aggregateId: input.threadId,
      occurredAt: input.createdAt,
      commandId: input.commandId,
    }),
    causationEventId: input.causationEventId,
    type: "thread.activity-appended",
    payload: {
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "info",
        kind: CHECKPOINT_REVERT_SUCCEEDED_ACTIVITY_KIND,
        summary: "Checkpoint revert completed",
        payload: { turnCount: input.turnCount },
        turnId: null,
        createdAt: input.createdAt,
      },
    },
  };
}

export type CommandDecisionInput<C extends OrchestrationCommand = OrchestrationCommand> = {
  readonly command: C;
  readonly readModel: OrchestrationReadModel;
  readonly workspacePaths?: SpaceAssignmentWorkspacePaths | undefined;
};

export type CommandDecisionEffect = Effect.Effect<
  Omit<OrchestrationEvent, "sequence"> | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
  OrchestrationCommandInvariantError
>;
