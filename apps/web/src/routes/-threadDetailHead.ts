import type { OrchestrationPendingInteraction } from "@glade/contracts/orchestration/threadEntities";
import type { OrchestrationThreadDetailHead } from "@glade/contracts/orchestration/snapshots";
import type { Thread } from "../types";

function sameMembers(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false;
  const members = new Set(left);
  return right.every((value) => members.has(value));
}

function countWhere<T>(items: ReadonlyArray<T>, predicate: (item: T) => boolean): number {
  let count = 0;
  for (const item of items) if (predicate(item)) count += 1;
  return count;
}

const interactionKey = (interaction: OrchestrationPendingInteraction): string =>
  [
    interaction.interactionKind,
    interaction.requestId,
    interaction.lifecycleGeneration ?? "",
    interaction.status,
  ].join("\u0000");

// Whether the live projection already holds everything the server head vouches for, so reading the
// full detail again would repair nothing. Any doubt answers no and the caller reads the full detail.
export function doesThreadDetailHeadMatch(input: {
  readonly head: OrchestrationThreadDetailHead;
  readonly appliedSequence: number;
  readonly thread: Pick<
    Thread,
    "session" | "latestTurn" | "messages" | "activities" | "pendingInteractions"
  >;
}): boolean {
  const { head, appliedSequence, thread } = input;
  if (head.detailSequence > appliedSequence) return false;

  const serverSession = head.session;
  const localSession = thread.session;
  if (
    (serverSession?.status ?? null) !== (localSession?.orchestrationStatus ?? null) ||
    (serverSession?.activeTurnId ?? null) !== (localSession?.activeTurnId ?? null)
  ) {
    return false;
  }

  const serverTurn = head.latestTurn;
  const localTurn = thread.latestTurn;
  if ((serverTurn?.turnId ?? null) !== (localTurn?.turnId ?? null)) return false;
  if (serverTurn !== null && localTurn !== null) {
    if (serverTurn.assistantMessageId !== localTurn.assistantMessageId) return false;
    // While a session runs, the client settles a turn as soon as an assistant segment finishes and the
    // server only when the session settles, so their turn states legitimately differ until then.
    const sessionActive =
      serverSession?.status === "running" || serverSession?.status === "starting";
    if (
      !sessionActive &&
      (serverTurn.state !== localTurn.state ||
        (serverTurn.completedAt === null) !== (localTurn.completedAt === null))
    ) {
      return false;
    }
    // Fewer than the server stores means a lost event; more only means the client is already ahead.
    const turnId = serverTurn.turnId;
    if (
      countWhere(thread.messages, (message) => message.turnId === turnId) <
        head.latestTurnMessageCount ||
      countWhere(thread.activities, (activity) => activity.turnId === turnId) <
        head.latestTurnActivityCount
    ) {
      return false;
    }
    const assistantMessageId = serverTurn.assistantMessageId;
    if (
      assistantMessageId !== null &&
      thread.messages.some((message) => message.id === assistantMessageId) !==
        head.latestTurnAssistantMessageStored
    ) {
      return false;
    }
  }

  const localStreamingIds = thread.messages
    .filter((message) => message.streaming)
    .map((message) => message.id);
  if (!sameMembers(localStreamingIds, head.streamingMessageIds)) return false;

  const localInteractions = (thread.pendingInteractions ?? []).filter(
    (interaction) => interaction.status !== "confirmed",
  );
  return sameMembers(
    localInteractions.map(interactionKey),
    head.pendingInteractions.map(interactionKey),
  );
}
