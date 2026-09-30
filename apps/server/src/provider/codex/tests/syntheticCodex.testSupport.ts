import { vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexAppServerManager } from "../codexAppServerManager";

type SyntheticCodexRequest = {
  readonly id?: string | number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
};

export function createSyntheticCodexAppServer(options?: {
  readonly forceFullHistoryResponse?: boolean;
}) {
  const historySentinel = "SYNTHETIC_PRIVATE_HISTORY_SENTINEL";
  const requests: SyntheticCodexRequest[] = [];
  const children: ChildProcessWithoutNullStreams[] = [];
  let oversizedResponseCount = 0;
  let nextPid = 50_000;
  let nextTurn = 1;

  const threadOpenResponse = (request: SyntheticCodexRequest, providerThreadId: string) => {
    const cwd = String(request.params?.cwd ?? process.cwd());
    return {
      thread: {
        id: providerThreadId,
        sessionId: providerThreadId,
        cliVersion: "0.158.0",
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_000,
        cwd,
        ephemeral: false,
        modelProvider: "openai",
        preview: "",
        projectId: null,
        source: "appServer",
        status: { type: "idle" },
        turns: [],
      },
      approvalPolicy: "never",
      approvalsReviewer: "user",
      cwd,
      model: "gpt-5.3-codex",
      modelProvider: "openai",
      sandbox: { type: "dangerFullAccess" },
    };
  };

  const buildFullHistoryFrame = (id: string | number, providerThreadId: string): Buffer => {
    const targetFrameBytes = 16_842_743;
    const prefix = Buffer.from(
      `{"id":${JSON.stringify(id)},"result":{"thread":{"id":${JSON.stringify(providerThreadId)},"turns":[{"payload":"${historySentinel}`,
      "utf8",
    );
    const suffix = Buffer.from('"}]}}}', "utf8");
    const fillerBytes = targetFrameBytes - prefix.length - suffix.length;
    if (fillerBytes < 0) throw new Error("Synthetic Codex frame prefix exceeds target size");
    return Buffer.concat(
      [prefix, Buffer.alloc(fillerBytes, 0x78), suffix, Buffer.from("\n")],
      targetFrameBytes + 1,
    );
  };

  const spawnAppServer = (): ChildProcessWithoutNullStreams => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdin,
      stdout,
      stderr,
      pid: nextPid++,
      exitCode: null,
      signalCode: null,
      killed: false,
    }) as unknown as ChildProcessWithoutNullStreams;
    children.push(child);

    let bufferedInput = "";
    stdin.on("data", (chunk: Buffer) => {
      bufferedInput += chunk.toString("utf8");
      for (;;) {
        const newline = bufferedInput.indexOf("\n");
        if (newline < 0) break;
        const line = bufferedInput.slice(0, newline);
        bufferedInput = bufferedInput.slice(newline + 1);
        if (!line) continue;
        const request = JSON.parse(line) as SyntheticCodexRequest;
        requests.push(request);
        if (request.id === undefined) {
          if (request.method !== "initialized") {
            throw new Error(`Unexpected Codex notification: ${request.method}`);
          }
          continue;
        }

        const respond = (result: unknown) => {
          queueMicrotask(() => stdout.write(`${JSON.stringify({ id: request.id, result })}\n`));
        };
        if (request.method === "initialize") {
          respond({});
        } else if (request.method === "skills/extraRoots/set") {
          respond({});
        } else if (request.method === "account/read") {
          respond({ account: { type: "apiKey" }, requiresOpenaiAuth: false });
        } else if (request.method === "thread/resume" || request.method === "thread/fork") {
          const providerThreadId = String(request.params?.threadId ?? "provider-thread");
          if (options?.forceFullHistoryResponse === true || request.params?.excludeTurns !== true) {
            oversizedResponseCount += 1;
            queueMicrotask(() =>
              stdout.write(buildFullHistoryFrame(request.id!, providerThreadId)),
            );
          } else {
            const result = threadOpenResponse(
              request,
              request.method === "thread/fork" ? `${providerThreadId}-forked` : providerThreadId,
            );
            respond(result);
          }
        } else if (request.method === "thread/start") {
          respond(threadOpenResponse(request, "fresh-provider-thread"));
        } else if (request.method === "turn/start") {
          respond({
            turn: { id: `synthetic-turn-${nextTurn++}`, items: [], status: "inProgress" },
          });
        } else {
          throw new Error(`Unexpected Codex request: ${request.method}`);
        }
      }
    });

    return child;
  };

  return {
    children,
    historySentinel,
    requests,
    spawnAppServer,
    get oversizedResponseCount() {
      return oversizedResponseCount;
    },
  };
}

export function createSyntheticCodexManager(fake: {
  readonly spawnAppServer: () => ChildProcessWithoutNullStreams;
}) {
  const teardownProcessTree = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
  const manager = new CodexAppServerManager(undefined, {
    spawnAppServer: fake.spawnAppServer,
    teardownProcessTree,
  });
  const internals = manager as unknown as {
    assertSupportedCodexCliVersion: () => Promise<void>;
    buildSessionProcessEnv: () => Promise<NodeJS.ProcessEnv>;
  };
  vi.spyOn(internals, "assertSupportedCodexCliVersion").mockResolvedValue(undefined);
  vi.spyOn(internals, "buildSessionProcessEnv").mockResolvedValue({});
  return { manager, teardownProcessTree };
}
