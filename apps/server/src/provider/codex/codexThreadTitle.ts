import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { JsonRpcStdioRequestRegistry } from "../../platform/transport/jsonRpcStdio";
import type { CodexProcessLease } from "./processPool/codexPooledProcess";

export interface CodexThreadTitleInput {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly model: string;
  readonly effort?: string;
  readonly instructions: string;
  readonly prompt: string;
  readonly outputSchema: unknown;
  readonly disabledCapabilities?: {
    readonly skillPaths: readonly string[];
    readonly mcpServerNames: readonly string[];
  };
}

export async function generateCodexThreadTitle(
  lease: CodexProcessLease,
  input: CodexThreadTitleInput,
  signal: AbortSignal,
): Promise<string> {
  const requests = new JsonRpcStdioRequestRegistry();
  let nativeThreadId: string | undefined;
  let turnId: string | undefined;
  let result = "";
  let turnFinished = false;
  let resolveTurn: (() => void) | undefined;
  let rejectTurn: ((cause: Error) => void) | undefined;
  const completed = new Promise<void>((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });
  // A failed thread/start can precede awaiting turn completion.
  void completed.catch(() => undefined);
  const fail = (cause: Error) => {
    requests.rejectAll(cause);
    rejectTurn?.(cause);
  };
  const request = (method: string, params: unknown, timeoutMs = 20_000) => {
    const id = lease.allocateRequest();
    return requests
      .requestWithId(id, method, params, lease.writer.write, timeoutMs)
      .finally(() => lease.finishRequest(id));
  };
  const unsubscribe = lease.subscribe({
    line: (line) => {
      try {
        const message = asObjectRecord(JSON.parse(line));
        if (!message) return;
        if (
          (typeof message.id === "string" || typeof message.id === "number") &&
          message.method === undefined
        ) {
          requests.handleResponse({
            id: message.id,
            ...(message.error
              ? { error: asObjectRecord(message.error) ?? { message: "Codex request failed" } }
              : { result: message.result }),
          });
          return;
        }
        if (message.id !== undefined) {
          void lease.writer
            .write({
              id: message.id,
              error: {
                code: -32601,
                message: "Title generation does not support tools or approvals",
              },
            })
            .catch(fail);
          fail(new Error("Codex title generation requested an unexpected tool or approval"));
          return;
        }
        const params = asObjectRecord(message.params);
        if (message.method === "item/completed") {
          const item = asObjectRecord(params?.item);
          if (item?.type === "agentMessage" && typeof item.text === "string") result = item.text;
        }
        if (message.method === "turn/completed") {
          turnFinished = true;
          turnId = undefined;
          const turn = asObjectRecord(params?.turn);
          const error = asObjectRecord(turn?.error);
          if (turn?.status !== "completed")
            fail(
              new Error(
                typeof error?.message === "string" ? error.message : "Codex title turn failed",
              ),
            );
          else resolveTurn?.();
        }
      } catch (cause) {
        fail(cause instanceof Error ? cause : new Error("Invalid Codex title response", { cause }));
      }
    },
    failure: fail,
    exit: () => fail(new Error("Codex process exited during title generation")),
  });
  const abort = () => rejectTurn?.(new Error("Codex title generation cancelled"));
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => fail(new Error("Codex title generation timed out")), 45_000);
  try {
    signal.throwIfAborted();
    await lease.openThread(async () => {
      const response = asObjectRecord(
        await request("thread/start", {
          model: input.model,
          cwd: input.cwd,
          ephemeral: true,
          approvalPolicy: "never",
          sandbox: "read-only",
          baseInstructions: input.instructions,
          developerInstructions: "",
          dynamicTools: [],
          selectedCapabilityRoots: [],
          environments: [],
          config: {
            // Override only enabled: replacing server entries loses transports, and config/read contains nulls.
            ...Object.fromEntries(
              (input.disabledCapabilities?.mcpServerNames ?? []).map((name) => [
                `mcp_servers.${name}.enabled`,
                false,
              ]),
            ),
            skills: {
              config:
                input.disabledCapabilities?.skillPaths.map((path) => ({ path, enabled: false })) ??
                [],
            },
            features: {
              sleep_tool: false,
              shell_tool: false,
              unified_exec: false,
              apps: false,
              hooks: false,
              browser_use: false,
              computer_use: false,
              image_generation: false,
              view_image: false,
              multi_agent: false,
              code_mode: false,
              code_mode_host: false,
              js_repl: false,
              skill_search: false,
              skip_host_skill_discovery: true,
              goals: false,
              plugins: false,
            },
            developer_instructions: "",
            project_doc_max_bytes: 0,
            memories: { use_memories: false, generate_memories: false },
            web_search: "disabled",
          },
        }),
      );
      const thread = asObjectRecord(response?.thread);
      if (typeof thread?.id !== "string")
        throw new Error("Codex title thread did not include an id");
      nativeThreadId = thread.id;
      lease.bindThread(thread.id);
    });
    signal.throwIfAborted();
    const response = asObjectRecord(
      await request("turn/start", {
        threadId: nativeThreadId,
        input: [{ type: "text", text: input.prompt, text_elements: [] }],
        ...(input.effort ? { effort: input.effort } : {}),
        outputSchema: input.outputSchema,
      }),
    );
    const turn = asObjectRecord(response?.turn);
    if (typeof turn?.id !== "string") throw new Error("Codex title turn did not include an id");
    if (!turnFinished) turnId = turn.id;
    await completed;
    turnId = undefined;
    if (!result) throw new Error("Codex did not return a title");
    return result;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    try {
      await (async () => {
        if (nativeThreadId) {
          if (turnId) await request("turn/interrupt", { threadId: nativeThreadId, turnId }, 5_000);
          await request("thread/unsubscribe", { threadId: nativeThreadId }, 5_000);
        }
      })().catch((cause: unknown) => {
        // Unconfirmed native cleanup must not leave an auxiliary turn running in the shared process.
        lease.invalidate(
          cause instanceof Error ? cause : new Error("Codex title cleanup failed", { cause }),
        );
        return Promise.reject(cause);
      });
    } finally {
      unsubscribe();
      requests.rejectAll(new Error("Codex title request ended"));
      await lease.release();
    }
  }
}
