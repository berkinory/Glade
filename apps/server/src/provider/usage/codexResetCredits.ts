import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import type {
  CodexResetCreditOutcome,
  ServerConsumeCodexResetCreditInput,
} from "@glade/contracts/server/server";
import { spawnProcess } from "@glade/shared/platform/processRuntime";

import { CodexJsonlFramer, CodexJsonlWriter } from "../codex/codexAppServerTransport";
import { signalOwnedChildProcess } from "../../platform/processTreeController";

const APP_SERVER_TIMEOUT_MS = 20_000;

type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export interface CodexResetCreditProbeInput {
  readonly binaryPath?: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
}

function canUseCodexResetCredit(json: unknown): boolean | undefined {
  const root = asObjectRecord(json);
  const buckets = asObjectRecord(root?.rateLimitsByLimitId);
  const core = buckets ? asObjectRecord(buckets.codex) : asObjectRecord(root?.rateLimits);
  const windows = [asObjectRecord(core?.primary), asObjectRecord(core?.secondary)]
    .map((window) => window?.usedPercent)
    .filter((used): used is number => typeof used === "number" && Number.isFinite(used));
  return windows.length === 0 ? undefined : windows.some((used) => used >= 90);
}

async function withAppServer<T>(
  input: CodexResetCreditProbeInput,
  run: (request: Request) => Promise<T>,
): Promise<T> {
  const child = spawnProcess(input.binaryPath?.trim() || "codex", ["app-server"], {
    cwd: input.cwd,
    env: input.env,
    stdio: "pipe",
  });
  const framer = new CodexJsonlFramer();
  const writer = new CodexJsonlWriter(child.stdin);
  let nextId = 0;
  let stopped = false;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const { promise: failed, reject: failSession } = Promise.withResolvers<never>();
  const fail = (cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    failSession(error);
  };
  const request: Request = (method, params) => {
    if (stopped) return Promise.reject(new Error("Codex reset-credit probe is closed."));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      void writer.write({ id, method, params }).catch(fail);
    });
  };
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.stdout.on("error", fail);
  child.stderr.resume();
  child.on("exit", () => {
    if (!stopped) fail(new Error("Codex app-server exited during the reset-credit request."));
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (stopped) return;
    try {
      for (const line of framer.push(chunk)) {
        if (!line.trim()) continue;
        const message = asObjectRecord(JSON.parse(line));
        if (!message) continue;
        if (typeof message.method === "string" && message.id !== undefined) {
          void writer
            .write({
              id: message.id,
              error: {
                code: -32601,
                message: "Interactive requests are unsupported by this usage probe.",
              },
            })
            .catch(fail);
          continue;
        }
        const waiter = typeof message.id === "number" ? pending.get(message.id) : undefined;
        if (!waiter) continue;
        pending.delete(message.id as number);
        if (message.error !== undefined)
          waiter.reject(new Error("Codex rejected the reset-credit request."));
        else waiter.resolve(message.result);
      }
    } catch (cause) {
      fail(cause);
    }
  });
  const timer = setTimeout(
    () => fail(new Error("Codex reset-credit request timed out. Retry the same attempt.")),
    APP_SERVER_TIMEOUT_MS,
  );
  try {
    return await Promise.race([
      failed,
      (async () => {
        await request("initialize", {
          clientInfo: { name: "glade", title: "Glade", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        });
        await writer.write({ method: "initialized" });
        return run(request);
      })(),
    ]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    const closed = new Error("Codex reset-credit probe closed.");
    writer.close(closed);
    for (const waiter of pending.values()) waiter.reject(closed);
    pending.clear();
    framer.close();
    try {
      signalOwnedChildProcess(child, "SIGTERM");
    } catch {}
    // A CLI/shim ignoring SIGTERM must not linger after a short-lived probe.
    const killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          signalOwnedChildProcess(child, "SIGKILL");
        } catch {}
      }
    }, 1_000);
    killTimer.unref();
    child.once("exit", () => clearTimeout(killTimer));
  }
}

const RESET_OUTCOMES: ReadonlySet<string> = new Set([
  "reset",
  "nothingToReset",
  "noCredit",
  "alreadyRedeemed",
]);

const activeResets = new Map<string, { key: string; promise: Promise<CodexResetCreditOutcome> }>();

export async function consumeCodexResetCredit(
  input: CodexResetCreditProbeInput & ServerConsumeCodexResetCreditInput,
): Promise<CodexResetCreditOutcome> {
  const active = activeResets.get(input.accountId);
  if (active) {
    if (active.key === input.idempotencyKey) return active.promise;
    throw new Error("A reset is already in progress for this Codex account.");
  }
  const promise = withAppServer(input, async (request) => {
    const usage = await request("account/rateLimits/read", {});
    if (nonEmptyTrimmed(asObjectRecord(usage)?.accountId) !== input.accountId) {
      throw new Error("The Codex account changed. Refresh usage before using a reset.");
    }
    const canUse = canUseCodexResetCredit(usage);
    if (canUse === undefined)
      throw new Error(
        "Current Codex usage is unavailable. Retry the same attempt when it returns.",
      );
    if (!canUse) return "nothingToReset";
    const result = await request("account/rateLimitResetCredit/consume", {
      idempotencyKey: input.idempotencyKey,
      ...(input.creditId ? { creditId: input.creditId } : {}),
    });
    const outcome = asObjectRecord(result)?.outcome;
    if (typeof outcome === "string" && RESET_OUTCOMES.has(outcome))
      return outcome as CodexResetCreditOutcome;
    throw new Error("Codex returned an unknown reset result. Retry the same attempt.");
  });
  activeResets.set(input.accountId, { key: input.idempotencyKey, promise });
  try {
    return await promise;
  } finally {
    activeResets.delete(input.accountId);
  }
}
