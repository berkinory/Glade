import { randomUUID } from "node:crypto";
import type { ProviderApprovalDecision } from "@glade/contracts/orchestration/orchestration";

interface PendingApproval {
  readonly threadId: string;
  readonly turnId?: string | undefined;
  readonly settle: (decision: ProviderApprovalDecision) => void;
}

interface TaskApprovalInput {
  readonly threadId: string;
  readonly turnId: string;
  readonly signal: AbortSignal;
  readonly publish: (requestId: string, decision?: ProviderApprovalDecision) => Promise<void>;
}

interface TaskApproval {
  readonly turnId: string;
  granted?: boolean;
  pending?: Promise<boolean> | undefined;
}

const COMPUTER_APPROVAL_QUEUE_FULL_CODE = "approval_queue_full";
const COMPUTER_APPROVAL_QUEUE_GLOBAL_LIMIT = 128;
const COMPUTER_APPROVAL_QUEUE_THREAD_LIMIT = 8;

class ComputerApprovalQueueFullError extends Error {
  readonly code = COMPUTER_APPROVAL_QUEUE_FULL_CODE;
  readonly retryable = true;
  constructor(scope: "thread" | "global") {
    super(
      scope === "thread"
        ? "Too many computer approvals are waiting for this chat; try again once an earlier prompt settles."
        : "Too many computer approvals are waiting.",
    );
    this.name = "ComputerApprovalQueueFullError";
  }
}

export class ComputerApprovalGate {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly tasks = new Map<string, TaskApproval>();
  // Visible-use consent is separate from routine Computer consent: allowing background input never
  // lets a task take the user's screen.
  private readonly foregroundTasks = new Map<string, TaskApproval>();

  cancelThread(threadId: string, turnId?: string): void {
    for (const tasks of [this.tasks, this.foregroundTasks]) {
      const task = tasks.get(threadId);
      if (turnId === undefined || task?.turnId === turnId) tasks.delete(threadId);
    }
    for (const [id, pending] of this.pending) {
      if (pending.threadId !== threadId || (turnId !== undefined && pending.turnId !== turnId))
        continue;
      this.pending.delete(id);
      pending.settle("cancel");
    }
  }

  // A desktop interruption (screen lock, sleep, or a session switch the GUI host reported) revokes
  // every standing task grant: consent answered before the interruption must not silently authorize
  // the post-interruption desktop, so the next mutating call republishes its prompt — the explicit
  // re-auth half of the locked-use boundary. Declines stay declined: a refusal is not the authority a
  // lock needs to break, and re-asking a refused thread on every unlock would only nag. Pending
  // prompts stay open: the prompt is unreachable while the desktop is interrupted, so any decision
  // that arrives afterward already postdates the interruption — that answer IS the re-auth, and
  // cancelling it would just ask the same question twice.
  revokeTaskGrants(): void {
    for (const task of [...this.tasks.values(), ...this.foregroundTasks.values()]) {
      if (task.granted === true) delete task.granted;
    }
  }

  // One consent for routine actions in the exact active turn, never a provider-wide grant.
  requestTask(input: TaskApprovalInput): Promise<boolean> {
    return this.requestTaskIn(this.tasks, input);
  }

  requestForegroundTask(input: TaskApprovalInput): Promise<boolean> {
    return this.requestTaskIn(this.foregroundTasks, input);
  }

  hasForegroundGrant(threadId: string, turnId: string): boolean {
    const task = this.foregroundTasks.get(threadId);
    return task?.turnId === turnId && task.granted === true;
  }

  private async requestTaskIn(
    tasks: Map<string, TaskApproval>,
    input: TaskApprovalInput,
  ): Promise<boolean> {
    input.signal.throwIfAborted();
    let task = tasks.get(input.threadId);
    if (task?.turnId !== input.turnId) {
      this.cancelStaleTurns(input.threadId, input.turnId);
      task = { turnId: input.turnId };
      tasks.set(input.threadId, task);
    }
    if (task.granted !== undefined) return task.granted;
    const current = task;
    current.pending ??= this.request(input)
      .then((accepted) => {
        if (tasks.get(input.threadId) !== current || input.signal.aborted) return false;
        current.granted = accepted;
        return accepted;
      })
      .finally(() => {
        current.pending = undefined;
      });

    let cancel: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(input.signal.reason);
      input.signal.addEventListener("abort", cancel, { once: true });
    });
    let accepted: boolean;
    try {
      input.signal.throwIfAborted();
      accepted = await Promise.race([current.pending, aborted]);
    } finally {
      if (cancel) input.signal.removeEventListener("abort", cancel);
    }
    input.signal.throwIfAborted();
    return accepted && tasks.get(input.threadId) === current;
  }

  private cancelStaleTurns(threadId: string, turnId: string): void {
    for (const tasks of [this.tasks, this.foregroundTasks]) {
      if (tasks.get(threadId)?.turnId !== turnId) tasks.delete(threadId);
    }
    for (const [id, pending] of this.pending) {
      if (pending.threadId !== threadId || pending.turnId === turnId) continue;
      this.pending.delete(id);
      pending.settle("cancel");
    }
  }

  respond(threadId: string, requestId: string, decision: ProviderApprovalDecision): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.threadId !== threadId) return false;
    this.pending.delete(requestId);

    const effective = decision === "acceptForSession" ? "decline" : decision;
    pending.settle(effective);
    return true;
  }

  async request(input: {
    threadId: string;
    turnId?: string | undefined;
    signal: AbortSignal;
    publish: (requestId: string, decision?: ProviderApprovalDecision) => Promise<void>;
  }): Promise<boolean> {
    input.signal.throwIfAborted();
    // A stuck turn must not starve every other chat: each thread gets a small cap inside the shared
    // one, and both refuse retryably so the model waits instead of treating a full queue as a denial.
    let threadPending = 0;
    for (const pending of this.pending.values()) {
      if (pending.threadId === input.threadId) threadPending += 1;
    }
    if (threadPending >= COMPUTER_APPROVAL_QUEUE_THREAD_LIMIT) {
      throw new ComputerApprovalQueueFullError("thread");
    }
    if (this.pending.size >= COMPUTER_APPROVAL_QUEUE_GLOBAL_LIMIT) {
      throw new ComputerApprovalQueueFullError("global");
    }
    const requestId = `computer:${randomUUID()}`;
    let settle!: (decision: ProviderApprovalDecision) => void;
    const answer = new Promise<ProviderApprovalDecision>((resolve) => {
      settle = resolve;
    });
    this.pending.set(requestId, {
      threadId: input.threadId,
      turnId: input.turnId,
      settle,
    });
    const cancel = () => settle("cancel");
    input.signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(cancel, 5 * 60_000);
    timeout.unref?.();
    let decision: ProviderApprovalDecision = "cancel";
    try {
      const published = input.publish(requestId).then(() => "ok" as const);
      const outcome = await Promise.race([published, answer]);
      void published.catch(() => undefined);
      if (outcome === "ok") {
        if (input.signal.aborted) cancel();
        decision = await answer;
      } else {
        decision = outcome;
      }
      input.signal.throwIfAborted();
      return decision === "accept";
    } finally {
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", cancel);
      this.pending.delete(requestId);
      // Best-effort dismissal: a hung or failed publish must not turn an accepted consent into a
      // rejection or hold the caller.
      void input.publish(requestId, decision).catch(() => undefined);
    }
  }
}

export const computerApprovalGate = new ComputerApprovalGate();
