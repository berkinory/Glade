import type { ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { isToolLifecycleItemType } from "@glade/contracts/provider/runtimeMetadata";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";

import { isNativeChildRuntimeEvent } from "./providerRuntimeBinding.ts";

const TURN_IDLE_TIMEOUT_ENV = "GLADE_TURN_IDLE_TIMEOUT_MS";
const DEFAULT_TURN_IDLE_TIMEOUT_MS = 15 * 60_000;

export function resolveTurnIdleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[TURN_IDLE_TIMEOUT_ENV]?.trim();
  if (!raw) return DEFAULT_TURN_IDLE_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TURN_IDLE_TIMEOUT_MS;
}

export interface IdleTurn {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
}

interface TrackedTurn {
  readonly turnId: TurnId;
  readonly lifecycleGeneration: string | undefined;
  lastEventAtMs: number;
  // A silent long-running tool or an unanswered request is work, not a wedge.
  readonly openItems: Set<string>;
  readonly openRequests: Set<string>;
}

const itemKey = (event: ProviderRuntimeEvent, itemType: string) =>
  event.itemId ?? event.providerRefs?.providerItemId ?? `unidentified:${itemType}`;

const requestKey = (event: ProviderRuntimeEvent) =>
  event.requestId ?? event.providerRefs?.providerRequestId ?? "unidentified";

function endsRuntime(event: ProviderRuntimeEvent): boolean {
  switch (event.type) {
    case "turn.completed":
    case "turn.aborted":
    case "session.exited":
      return true;
    case "session.state.changed":
      return event.payload.state === "stopped" || event.payload.state === "error";
    case "thread.state.changed":
      return event.payload.state === "archived" || event.payload.state === "closed";
    default:
      return false;
  }
}

// Tracks, per thread, how long the live main turn has gone without any runtime event and whether
// anything it owns is still legitimately in flight. Subagent work is owned by the parent turn, so
// it keeps that turn alive without changing what the parent has open.
export function makeTurnIdleTracker() {
  const turns = new Map<ThreadId, TrackedTurn>();

  const observe = (event: ProviderRuntimeEvent, nowMs: number): void => {
    if (event.type === "turn.started" && event.turnId && !isNativeChildRuntimeEvent(event)) {
      turns.set(event.threadId, {
        turnId: event.turnId,
        lifecycleGeneration: event.lifecycleGeneration,
        lastEventAtMs: nowMs,
        openItems: new Set(),
        openRequests: new Set(),
      });
      return;
    }
    const turn = turns.get(event.threadId);
    if (
      !turn ||
      (event.lifecycleGeneration !== undefined &&
        turn.lifecycleGeneration !== undefined &&
        event.lifecycleGeneration !== turn.lifecycleGeneration)
    ) {
      return;
    }
    if (isNativeChildRuntimeEvent(event)) {
      turn.lastEventAtMs = nowMs;
      return;
    }
    if (event.turnId !== undefined && event.turnId !== turn.turnId) return;
    if (endsRuntime(event)) {
      turns.delete(event.threadId);
      return;
    }
    turn.lastEventAtMs = nowMs;
    switch (event.type) {
      case "item.started":
        if (isToolLifecycleItemType(event.payload.itemType)) {
          turn.openItems.add(itemKey(event, event.payload.itemType));
        }
        return;
      case "item.updated":
        if (event.payload.status !== undefined && event.payload.status !== "inProgress") {
          turn.openItems.delete(itemKey(event, event.payload.itemType));
        }
        return;
      case "item.completed":
        turn.openItems.delete(itemKey(event, event.payload.itemType));
        return;
      case "request.opened":
      case "user-input.requested":
        turn.openRequests.add(requestKey(event));
        return;
      case "request.resolved":
      case "user-input.resolved":
        turn.openRequests.delete(requestKey(event));
        return;
    }
  };

  const idleTurns = (nowMs: number, timeoutMs: number): ReadonlyArray<IdleTurn> =>
    [...turns].flatMap(([threadId, turn]) =>
      turn.openItems.size === 0 &&
      turn.openRequests.size === 0 &&
      nowMs - turn.lastEventAtMs >= timeoutMs
        ? [{ threadId, turnId: turn.turnId }]
        : [],
    );

  const isCurrent = (idle: IdleTurn) => turns.get(idle.threadId)?.turnId === idle.turnId;

  const touch = (idle: IdleTurn, nowMs: number): void => {
    const turn = turns.get(idle.threadId);
    if (turn?.turnId === idle.turnId) turn.lastEventAtMs = nowMs;
  };

  const forget = (idle: IdleTurn): void => {
    if (isCurrent(idle)) turns.delete(idle.threadId);
  };

  return { observe, idleTurns, isCurrent, touch, forget };
}
