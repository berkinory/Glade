import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { JsonRpcStdioRequestTimeoutError } from "../../platform/transport/jsonRpcStdio";

interface ShutdownTransport {
  readonly request: (
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<unknown>;
}

const metadata = z.object({
  thread: z.object({
    id: z.string(),
    status: z.object({ type: z.enum(["idle", "active", "notLoaded", "systemError"]) }),
  }),
});
const turns = z.object({ data: z.array(z.object({ id: z.string(), status: z.string() })) });
const terminals = z.object({ data: z.array(z.unknown()), nextCursor: z.string().nullable() });
const completion = z.object({
  threadId: z.string(),
  turn: z.object({ id: z.string(), status: z.enum(["completed", "interrupted", "failed"]) }),
});

export class CodexThreadShutdown {
  private readonly completed = new Map<string, string>();

  constructor(private readonly transport: ShutdownTransport) {}

  observe(method: string, params: unknown): void {
    if (method !== "turn/completed") return;
    const parsed = completion.safeParse(params);
    if (parsed.success) this.completed.set(parsed.data.threadId, parsed.data.turn.id);
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.transport.request(method, params, 5_000);
  }

  private async interrupt(threadId: string, turnId: string): Promise<void> {
    try {
      await this.request("turn/interrupt", { threadId, turnId });
    } catch (cause) {
      // A missing acknowledgement is not evidence of a dead transport. Reconcile native state.
      if (
        cause instanceof JsonRpcStdioRequestTimeoutError ||
        (cause instanceof Error && /no active turn(?: to interrupt)?/i.test(cause.message))
      )
        return;
      if (this.completed.get(threadId) === turnId) return;
      throw cause;
    }
  }

  async stop(threadId: string, turnId?: string): Promise<void> {
    if (turnId) await this.interrupt(threadId, turnId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { thread } = metadata.parse(
        await this.request("thread/read", { threadId, includeTurns: false }),
      );
      if (thread.id !== threadId) throw new Error("Codex shutdown thread identity mismatch.");
      if (thread.status.type === "notLoaded") return;
      if (thread.status.type === "idle") {
        await this.cleanTerminals(threadId);
        return;
      }
      if (thread.status.type !== "active" || attempt === 2) break;
      const latest = turns.parse(
        await this.request("thread/turns/list", {
          threadId,
          sortDirection: "desc",
          limit: 1,
          itemsView: "summary",
        }),
      ).data[0];
      if (latest?.status === "inProgress") await this.interrupt(threadId, latest.id);
      await delay(100);
    }
    throw new Error("Codex thread is still active after cancellation.");
  }

  private async cleanTerminals(threadId: string): Promise<void> {
    try {
      await this.request("thread/backgroundTerminals/clean", { threadId });
    } catch (cause) {
      if (!(cause instanceof JsonRpcStdioRequestTimeoutError)) throw cause;
    }
    // A completed turn can still own running shell commands. Verify cleanup independently.
    const remaining = terminals.parse(
      await this.request("thread/backgroundTerminals/list", { threadId }),
    );
    if (remaining.data.length > 0 || remaining.nextCursor !== null)
      throw new Error("Codex background commands are still running after cancellation.");
  }
}
