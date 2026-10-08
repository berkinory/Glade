import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { PersistedProviderRuntimeEvent } from "../../persistence/Services/ProviderRuntimeEvents.ts";
import { type ProviderServiceShape } from "../Services/ProviderService.ts";
import {
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  type ProviderSession,
} from "@glade/contracts/provider/provider";
import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { type ProviderRuntimeBinding } from "../Services/ProviderSessionDirectory.ts";
import { ModelSelection, ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { Schema, Option } from "effect";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { AGENT_GATEWAY_TURN_AUTHORITY_RETIRED } from "../../agentGateway/sessionLease.ts";

export type StopRuntimeSession = ProviderServiceShape["stopRuntimeSession"];

export type StopRuntimeSessionInput = Parameters<StopRuntimeSession>[0];

export type StopRuntimeSessionEffect = ReturnType<StopRuntimeSession>;

export type TargetedChildInterruptTombstone = {
  readonly lifecycleGeneration: string | undefined;
  readonly state: "uncertain" | "confirmed";
};

export type InteractionResponse =
  | { readonly kind: "approval"; readonly input: ProviderRespondToRequestInput }
  | { readonly kind: "userInput"; readonly input: ProviderRespondToUserInputInput };

export const PRIOR_TRANSCRIPT_BOOTSTRAP_PENDING = "priorTranscriptBootstrapPending";

export function toRuntimeStatus(
  session: ProviderSession,
): "starting" | "running" | "stopped" | "error" {
  if (session.status === "connecting") return "starting";
  if (session.status === "closed") return "stopped";
  return session.status === "error" ? "error" : "running";
}

export function toRuntimePayloadFromSession(
  session: ProviderSession,
  extra?: {
    readonly modelSelection?: unknown;
    readonly providerOptions?: unknown;
    readonly lastRuntimeEvent?: string;
    readonly lastRuntimeEventAt?: string;
    readonly lifecycleGeneration?: string;
  },
): Record<string, unknown> {
  return {
    cwd: session.cwd ?? null,
    model: session.model ?? null,
    activeTurnId: nonEmptyTrimmed(session.activeTurnId) ?? null,

    lastError: nonEmptyTrimmed(session.lastError) ?? null,
    ...(extra?.modelSelection !== undefined ? { modelSelection: extra.modelSelection } : {}),
    ...(extra?.providerOptions !== undefined ? { providerOptions: extra.providerOptions } : {}),
    ...(extra?.lastRuntimeEvent !== undefined ? { lastRuntimeEvent: extra.lastRuntimeEvent } : {}),
    ...(extra?.lastRuntimeEventAt !== undefined
      ? { lastRuntimeEventAt: extra.lastRuntimeEventAt }
      : {}),
    ...(extra?.lifecycleGeneration !== undefined
      ? { lifecycleGeneration: extra.lifecycleGeneration }
      : {}),
  };
}

export function readPersistedModelSelection(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): ModelSelection | undefined {
  const raw = (asRecord(runtimePayload) ?? {}).modelSelection;
  return Schema.is(ModelSelection)(raw) ? raw : undefined;
}

export function readPersistedProviderOptions(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): ProviderStartOptions | undefined {
  const raw = (asRecord(runtimePayload) ?? {}).providerOptions;
  return Option.getOrUndefined(Schema.decodeUnknownOption(ProviderStartOptions)(raw));
}

export function readPersistedCwd(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): string | undefined {
  const rawCwd = (asRecord(runtimePayload) ?? {}).cwd;
  if (typeof rawCwd !== "string") return undefined;
  const trimmed = rawCwd.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function runtimeEventRetiredGatewayTurnAuthority(event: ProviderRuntimeEvent): boolean {
  return (asRecord(event.raw?.payload) ?? {})[AGENT_GATEWAY_TURN_AUTHORITY_RETIRED] === true;
}

export function runtimeActiveTurnId(value: unknown): string | undefined {
  const activeTurnId = (asRecord(value) ?? {}).activeTurnId;
  return typeof activeTurnId === "string" ? activeTurnId : undefined;
}

export function hasResumeCursor(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export // Keep this predicate strictly about lifecycle: it also drives `runtimeStatusForEvent` and
// resume-cursor decisions, so interaction resolutions must never be folded in here (see
// `isStaleSettlingRuntimeEvent`).
function isTerminalRuntimeEvent(event: ProviderRuntimeEvent): boolean {
  return (
    event.type === "turn.completed" ||
    event.type === "turn.aborted" ||
    event.type === "session.exited" ||
    event.type === "runtime.error"
  );
}

// True for events that settle a durable pending interaction (an approval or an AskUserQuestion
// user-input request). These are not lifecycle events, but like terminal events they are the only
// signal that can cleanly close a row the projection would otherwise leave `pending` forever.
function isInteractionResolutionRuntimeEvent(event: ProviderRuntimeEvent): boolean {
  return event.type === "user-input.resolved" || event.type === "request.resolved";
}

export function isStaleSettlingRuntimeEvent(event: ProviderRuntimeEvent): boolean {
  return isTerminalRuntimeEvent(event) || isInteractionResolutionRuntimeEvent(event);
}

export function runtimeStatusForEvent(
  event: ProviderRuntimeEvent,
  activeTurnId?: unknown,
): "running" | "stopped" | "error" {
  switch (event.type) {
    case "session.state.changed":
      if (event.payload.state === "stopped") return "stopped";
      return event.payload.state === "error" ? "error" : "running";
    case "thread.state.changed":
      if (event.payload.state === "error") return "error";
      if (event.payload.state === "archived" || event.payload.state === "closed") return "stopped";
      return event.payload.state === "compacted" &&
        event.turnId === undefined &&
        activeTurnId == null
        ? "stopped"
        : "running";
    case "session.exited":
    case "turn.completed":
    case "turn.aborted":
      // A completed turn can still carry a resume cursor, but it must not keep the desktop app treating
      // the provider process as active after restart.
      return "stopped";
    case "runtime.error":
      return "error";
    default:
      return "running";
  }
}

export function shouldRefreshResumeCursorForEvent(event: ProviderRuntimeEvent): boolean {
  return (
    event.type === "thread.started" ||
    event.type === "model.rerouted" ||
    (event.type === "thread.state.changed" &&
      event.payload.state === "compacted" &&
      event.turnId === undefined) ||
    event.type === "turn.tasks.updated" ||
    event.type === "turn.completed" ||
    event.type === "turn.aborted"
  );
}

export function runtimeLastErrorForEvent(event: ProviderRuntimeEvent): string | null | undefined {
  // A blank message must not degrade to `null`: null means "clear the error", which would erase the
  // very failure being reported. Fall back to an honest constant instead.
  if (event.type === "runtime.error")
    return nonEmptyTrimmed(event.payload.message) ?? "Provider runtime reported an error.";
  if (event.type === "session.state.changed")
    return event.payload.state === "error"
      ? (nonEmptyTrimmed(event.payload.reason) ?? "Session error")
      : null;
  if (event.type === "thread.state.changed")
    return event.payload.state === "error" ? "Thread error" : null;
  return event.type === "turn.started" ||
    event.type === "turn.completed" ||
    event.type === "turn.aborted" ||
    event.type === "session.exited"
    ? null
    : undefined;
}

export type PublishedRuntimeEvent = {
  readonly event: ProviderRuntimeEvent;
  readonly persisted?: PersistedProviderRuntimeEvent;
};

export interface StartedTurnPersistenceInput {
  readonly threadId: ThreadId;
  readonly provider: ProviderRuntimeBinding["provider"];
  readonly turnId: string;
  readonly generation: number;

  readonly lifecycleGeneration?: string;
  readonly resumeCursor?: unknown;
  readonly modelSelection?: unknown;
  readonly lastRuntimeEvent: string;
}
