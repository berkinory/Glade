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

export function prestartClaudeMessageStream(
  queryRuntime: ClaudeQueryRuntime,
): AsyncIterable<SDKMessage> {
  // SDK discovery waits for a handshake that only starts on the first iterator read. Keep that read
  // for the real stream consumer, while making cancellation win the race so session teardown never
  // waits on an unread first message.
  const iterator = queryRuntime[Symbol.asyncIterator]();
  const firstResult = iterator.next();
  void firstResult.catch(() => undefined);
  const doneResult: IteratorResult<SDKMessage> = { done: true, value: undefined };
  let resolveClosed!: (result: IteratorResult<SDKMessage>) => void;
  const closedResult = new Promise<IteratorResult<SDKMessage>>((resolve) => {
    resolveClosed = resolve;
  });
  let firstResultPending = true;
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
      const result = firstResultPending ? firstResult : iterator.next();
      firstResultPending = false;
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
