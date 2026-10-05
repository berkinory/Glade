import { createHash } from "node:crypto";
import type { ProviderThreadTurnSnapshot } from "../Services/ProviderAdapter";
import { asRecord } from "@glade/shared/transport/payloadValues";

interface ChildSnapshot {
  threadId: string;
  turns: readonly ProviderThreadTurnSnapshot[];
  agentNickname?: string;
  agentRole?: string;
  model?: string;
}

interface SnapshotNotification {
  method: string;
  params: Record<string, unknown>;
}

interface ChildState {
  dirty: boolean;
  active: boolean;
  readFailures: number;
  retryPending: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  awaitingTurn: boolean;
  pendingTurnReads: number;
  pending: Promise<void> | undefined;
  turnId: string | undefined;
  terminal: string | undefined;
  metadata: string | undefined;
  items: Map<string, string>;
}

interface ChildSnapshotPorts {
  read: (childId: string) => Promise<ChildSnapshot>;
  isCurrent: () => boolean;
  parentTurnId: (childId: string) => string | undefined;
  publish: (childId: string, notification: SnapshotNotification) => void;
  onError: (childId: string, cause: unknown) => void;
}

export class CodexChildSnapshots {
  private readonly children = new Map<string, ChildState>();

  constructor(private readonly ports: ChildSnapshotPorts) {}

  observe(childId: string, kind: string | undefined): void {
    if (!this.ports.isCurrent()) return;
    let state = this.children.get(childId);
    if (!state) {
      state = {
        dirty: false,
        active: false,
        readFailures: 0,
        retryPending: false,
        timer: undefined,
        awaitingTurn: false,
        pendingTurnReads: 0,
        pending: undefined,
        turnId: undefined,
        terminal: undefined,
        metadata: undefined,
        items: new Map(),
      };
      this.children.set(childId, state);
    }
    state.dirty = true;
    if (kind !== undefined) {
      state.active = kind === "started" || kind === "interacted";
      state.awaitingTurn = state.active;
      state.pendingTurnReads = 0;
    }
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
    if (state.pending) return;
    const child = state;
    child.pending = this.refresh(childId, child)
      .catch((cause: unknown) => {
        // Codex can announce a child before writing its rollout's first metadata record.
        const initializing = cause instanceof Error && /rollout .* is empty/.test(cause.message);
        child.retryPending = initializing && child.readFailures++ < 3;
        if (!child.retryPending) {
          child.active = false;
          if (this.ports.isCurrent()) this.ports.onError(childId, cause);
        }
      })
      .finally(() => {
        child.pending = undefined;
        // Some Codex child transcript updates are absent from the parent connection.
        // Read only active children; this is local state access, not another model request.
        if ((child.active || child.retryPending) && this.ports.isCurrent()) {
          child.timer = setTimeout(() => this.observe(childId, undefined), 2_000);
          child.timer.unref();
        }
      });
  }

  private async refresh(childId: string, state: ChildState): Promise<void> {
    do {
      state.dirty = false;
      const snapshot = await this.ports.read(childId);
      if (!this.ports.isCurrent()) return;
      state.readFailures = 0;
      state.retryPending = false;
      if (snapshot.threadId !== childId)
        throw new Error("Native child snapshot identity mismatch.");
      const turn = snapshot.turns.at(-1);
      const ownTurn = turn && turn.id !== this.ports.parentTurnId(childId) ? turn : undefined;
      const awaitingNewTurn =
        state.awaitingTurn &&
        ownTurn !== undefined &&
        ownTurn.id === state.turnId &&
        ownTurn.status !== "inProgress";
      if (awaitingNewTurn && ++state.pendingTurnReads >= 3) {
        state.active = false;
        state.awaitingTurn = false;
      }
      this.projectMetadata(childId, state, snapshot, awaitingNewTurn ? undefined : ownTurn);
      // A fork can initially expose the parent's current turn before the child has started its own.
      if (ownTurn && !awaitingNewTurn) {
        state.awaitingTurn = false;
        if (ownTurn.status && ownTurn.status !== "inProgress") state.active = false;
        this.project(childId, state, ownTurn);
      }
    } while (state.dirty && this.ports.isCurrent());
  }

  private projectMetadata(
    childId: string,
    state: ChildState,
    snapshot: ChildSnapshot,
    turn: ProviderThreadTurnSnapshot | undefined,
  ): void {
    const publish = (method: string, params: Record<string, unknown>) =>
      this.ports.publish(childId, { method, params });
    const metadata = JSON.stringify([
      snapshot.agentNickname,
      snapshot.agentRole,
      snapshot.model,
      turn?.status,
    ]);
    if (metadata !== state.metadata) {
      state.metadata = metadata;
      publish("item/completed", {
        childMetadata: true,
        item: {
          type: "collabAgentToolCall",
          id: `child-metadata:${childId}`,
          tool: "agentActivity",
          status: "completed",
          receiverThreadIds: [childId],
          receiverAgents: [
            {
              threadId: childId,
              agentNickname: snapshot.agentNickname,
              agentRole: snapshot.agentRole,
              model: snapshot.model,
            },
          ],
          agentsStates: turn
            ? { [childId]: { status: turn.status === "inProgress" ? "running" : turn.status } }
            : {},
        },
      });
    }
  }

  private project(childId: string, state: ChildState, turn: ProviderThreadTurnSnapshot): void {
    const publish = (method: string, params: Record<string, unknown>) =>
      this.ports.publish(childId, { method, params });
    if (state.turnId !== turn.id) {
      state.turnId = turn.id;
      state.terminal = undefined;
      state.items.clear();
      if (turn.status === "inProgress")
        publish("turn/started", { threadId: childId, turn: { id: turn.id, status: "inProgress" } });
    }
    for (const value of turn.items) {
      const item = asRecord(value);
      if (!item || typeof item.id !== "string") continue;
      // Forked history is data, never a new collaboration request or a snapshot-read trigger.
      if (
        item.type === "subAgentActivity" ||
        item.type === "collabAgentToolCall" ||
        item.type === "collabToolCall"
      )
        continue;
      const digest = createHash("sha256").update(JSON.stringify(item)).digest("hex");
      if (state.items.get(item.id) === digest) continue;
      state.items.set(item.id, digest);
      publish(item.status === "inProgress" ? "item/started" : "item/completed", {
        threadId: childId,
        turnId: turn.id,
        item,
      });
    }
    if (turn.status && turn.status !== "inProgress" && state.terminal !== turn.status) {
      state.terminal = turn.status;
      publish("turn/completed", { threadId: childId, turn: { id: turn.id, status: turn.status } });
    }
  }
}
