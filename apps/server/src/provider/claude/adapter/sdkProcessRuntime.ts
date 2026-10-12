import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  SDKMessage,
  SpawnOptions as ClaudeSpawnOptions,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { spawnProcess, execProcessFile } from "@glade/shared/platform/processRuntime";
import { parseGenericCliVersion } from "../../core/providerMaintenance.ts";
import { ClaudeQueryRuntime, ClaudeOwnedProcess } from "./adapterConfiguration";

export const CLAUDE_DISCOVERY_THREAD_ID = ThreadId.makeUnsafe("claude:discovery");

export function cancellableClaudeMessageStream(
  queryRuntime: ClaudeQueryRuntime,
  options: { readonly prestart: boolean },
): AsyncIterable<SDKMessage> {
  // Stream interruption awaits the iterator's `return()`, and the SDK query is an async generator
  // whose `return()` queues behind the pending `next()`, which never settles while Claude is idle.
  // Cancellation must win that race or stopping an idle session never reaches process teardown.
  // SDK discovery (Auto mode) waits for a handshake that only starts on the first iterator read, so
  // `prestart` issues that read now and keeps it for the real consumer.
  const iterator = queryRuntime[Symbol.asyncIterator]();
  let firstResult = options.prestart ? iterator.next() : undefined;
  void firstResult?.catch(() => undefined);
  const doneResult: IteratorResult<SDKMessage> = { done: true, value: undefined };
  let resolveClosed!: (result: IteratorResult<SDKMessage>) => void;
  const closedResult = new Promise<IteratorResult<SDKMessage>>((resolve) => {
    resolveClosed = resolve;
  });
  let closed = false;

  const raceWithClose = (
    result: Promise<IteratorResult<SDKMessage>>,
  ): Promise<IteratorResult<SDKMessage>> => {
    void result.catch(() => undefined);
    return Promise.race([result, closedResult]);
  };

  const messageIterator: AsyncIterableIterator<SDKMessage> = {
    next: () => {
      if (closed) {
        return Promise.resolve(doneResult);
      }
      const result = firstResult ?? iterator.next();
      firstResult = undefined;
      return raceWithClose(result);
    },
    return: async () => {
      if (!closed) {
        closed = true;
        resolveClosed(doneResult);
        const returnResult = iterator.return?.();
        if (returnResult) {
          void returnResult.catch(() => undefined);
        }
      }
      return doneResult;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  return messageIterator;
}

export function spawnOwnedClaudeCodeProcess(options: ClaudeSpawnOptions): ClaudeOwnedProcess {
  return spawnProcess(options.command, options.args, {
    requireExecutable: true,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: options.env,
    signal: options.signal,
    stdio: ["pipe", "pipe", "inherit"],
  }) as unknown as ClaudeOwnedProcess;
}

export async function readInstalledClaudeCliVersion(input: {
  readonly binaryPath: string;
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execProcessFile(
      input.binaryPath,
      ["--version"],
      {
        requireExecutable: true,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        env: input.env,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(parseGenericCliVersion(`${stdout}\n${stderr}`));
      },
    );
  });
}

export function neverResolvingUserMessageStream(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
      return {
        next: async () => new Promise<IteratorResult<SDKUserMessage>>(() => {}),
      };
    },
  };
}
