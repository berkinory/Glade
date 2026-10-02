import {
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  PlatformError,
  Ref,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { makeEffectProcessCommand } from "../../platform/effectProcessRuntime.ts";
import { decodeJsonResult } from "../../platform/schemaJson.ts";
import { GitProcessQueue } from "../gitProcessQueue";
import { makeKeyedSingleFlightCache } from "../../pullRequests/KeyedSingleFlightCache";
import { GitCommandError } from "../Errors.ts";
import type {
  ExecuteGitInput,
  ExecuteGitProgress,
  ExecuteGitResult,
  GitCoreShape,
} from "../Services/GitCore.ts";
import { GitCommands, type ExecuteGitOptions } from "../Services/GitCommands.ts";

const COALESCED_READ_COMMANDS = new Set([
  "status",
  "diff",
  "rev-parse",
  "rev-list",
  "show-ref",
  "symbolic-ref",
  "for-each-ref",
  "log",
  "show",
  "ls-files",
]);

const DEFAULT_TIMEOUT_MS = 30_000;

export const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

type TraceTailState = {
  processedBytes: number;

  remainder: Uint8Array;
};

const NEWLINE_BYTE = 0x0a;

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left, 0);
  combined.set(right, left.length);
  return combined;
}

export function truncateUtf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maxBytes) return value;

  let prefixEnd = maxBytes;
  while (prefixEnd > 0 && ((encoded[prefixEnd] ?? 0) & 0xc0) === 0x80) {
    prefixEnd -= 1;
  }
  return encoded.subarray(0, prefixEnd).toString("utf8");
}

export function commandLabel(args: readonly string[]): string {
  return `git ${args.join(" ")}`;
}

export function createGitCommandError(
  operation: string,
  cwd: string,
  args: readonly string[],
  detail: string,
  cause?: unknown,
): GitCommandError {
  return new GitCommandError({
    operation,
    command: commandLabel(args),
    cwd,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

export function isMissingGitCwdError(error: GitCommandError): boolean {
  const normalized = `${error.detail}\n${error.message}`.toLowerCase();
  return (
    normalized.includes("no such file or directory") ||
    normalized.includes("notfound: filesystem.access") ||
    normalized.includes("enoent") ||
    normalized.includes("not a directory")
  );
}

function toGitCommandError(
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  detail: string,
) {
  return (cause: unknown) =>
    Schema.is(GitCommandError)(cause)
      ? cause
      : new GitCommandError({
          operation: input.operation,
          command: commandLabel(input.args),
          cwd: input.cwd,
          detail: `${cause instanceof Error && cause.message.length > 0 ? cause.message : "Unknown error"} - ${detail}`,
          ...(cause !== undefined ? { cause } : {}),
        });
}

interface Trace2Monitor {
  readonly env: NodeJS.ProcessEnv;
  readonly flush: Effect.Effect<void, never>;
}

function trace2ChildKey(record: Record<string, unknown>): string | null {
  const childId = record.child_id;
  if (typeof childId === "number" || typeof childId === "string") {
    return String(childId);
  }
  const hookName = record.hook_name;
  return typeof hookName === "string" && hookName.trim().length > 0 ? hookName.trim() : null;
}

const Trace2Record = Schema.Record(Schema.String, Schema.Unknown);

const createTrace2Monitor = Effect.fn(function* (
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  progress: ExecuteGitProgress | undefined,
): Effect.fn.Return<
  Trace2Monitor,
  PlatformError.PlatformError,
  Scope.Scope | FileSystem.FileSystem | Path.Path
> {
  if (!progress?.onHookStarted && !progress?.onHookFinished) {
    return {
      env: {},
      flush: Effect.void,
    };
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const traceFilePath = yield* fs.makeTempFileScoped({
    prefix: `glade-git-trace2-${process.pid}-`,
    suffix: ".json",
  });
  const hookStartByChildKey = new Map<string, { hookName: string; startedAtMs: number }>();
  const traceTailState = yield* Ref.make<TraceTailState>({
    processedBytes: 0,
    remainder: new Uint8Array(0),
  });
  const traceDecoder = new TextDecoder();

  const handleTraceLine = (line: string) =>
    Effect.gen(function* () {
      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) {
        return;
      }

      const traceRecord = decodeJsonResult(Trace2Record)(trimmedLine);
      if (Result.isFailure(traceRecord)) {
        yield* Effect.logDebug(
          `GitCore.trace2: failed to parse trace line for ${commandLabel(input.args)} in ${input.cwd}`,
          traceRecord.failure,
        );
        return;
      }

      if (traceRecord.success.child_class !== "hook") {
        return;
      }

      const event = traceRecord.success.event;
      const childKey = trace2ChildKey(traceRecord.success);
      if (childKey === null) {
        return;
      }
      const started = hookStartByChildKey.get(childKey);
      const hookNameFromEvent =
        typeof traceRecord.success.hook_name === "string"
          ? traceRecord.success.hook_name.trim()
          : "";
      const hookName = hookNameFromEvent.length > 0 ? hookNameFromEvent : (started?.hookName ?? "");
      if (hookName.length === 0) {
        return;
      }

      if (event === "child_start") {
        hookStartByChildKey.set(childKey, { hookName, startedAtMs: Date.now() });
        if (progress.onHookStarted) {
          yield* progress.onHookStarted(hookName);
        }
        return;
      }

      if (event === "child_exit") {
        hookStartByChildKey.delete(childKey);
        if (progress.onHookFinished) {
          const code = traceRecord.success.code;
          yield* progress.onHookFinished({
            hookName: started?.hookName ?? hookName,
            exitCode: typeof code === "number" && Number.isInteger(code) ? code : null,
            durationMs: started ? Math.max(0, Date.now() - started.startedAtMs) : null,
          });
        }
      }
    });

  const deltaMutex = yield* Semaphore.make(1);

  const readTraceDelta = deltaMutex.withPermit(
    Effect.gen(function* () {
      const { processedBytes } = yield* Ref.get(traceTailState);
      const appended = yield* Stream.runFold(
        fs.stream(traceFilePath, { offset: processedBytes }),
        () => new Uint8Array(0),
        concatBytes,
      );
      if (appended.length === 0) {
        return;
      }
      yield* Effect.uninterruptible(
        Ref.modify(traceTailState, ({ processedBytes: consumed, remainder }) => {
          const combined = concatBytes(remainder, appended);
          const lastNewline = combined.lastIndexOf(NEWLINE_BYTE);
          if (lastNewline === -1) {
            return [[], { processedBytes: consumed + appended.length, remainder: combined }];
          }
          const lines = traceDecoder
            .decode(combined.subarray(0, lastNewline))
            .split("\n")
            .map((line) => line.replace(/\r$/, ""));
          return [
            lines,
            {
              processedBytes: consumed + appended.length,
              remainder: combined.slice(lastNewline + 1),
            },
          ];
        }).pipe(
          Effect.flatMap((lines) => Effect.forEach(lines, handleTraceLine, { discard: true })),
        ),
      );
    }).pipe(Effect.ignore({ log: true })),
  );
  const traceFileName = path.basename(traceFilePath);
  yield* Stream.runForEach(fs.watch(traceFilePath), (event) => {
    const eventPath = event.path;
    const isTargetTraceEvent =
      eventPath === traceFilePath ||
      eventPath === traceFileName ||
      path.basename(eventPath) === traceFileName;
    if (!isTargetTraceEvent) return Effect.void;
    return readTraceDelta;
  }).pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* readTraceDelta;
      const finalLine = yield* Ref.modify(traceTailState, ({ processedBytes, remainder }) => [
        traceDecoder.decode(remainder).trim(),
        {
          processedBytes,
          remainder: new Uint8Array(0),
        },
      ]);
      if (finalLine.length > 0) {
        yield* handleTraceLine(finalLine);
      }
    }),
  );

  return {
    env: {
      GIT_TRACE2_EVENT: traceFilePath,
    },
    flush: readTraceDelta,
  };
});

interface CollectedGitOutput {
  readonly text: string;
  readonly truncated: boolean;
}

const collectGitOutput = Effect.fn(function* <E>(
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  stream: Stream.Stream<Uint8Array, E>,
  maxOutputBytes: number,
  onLine: ((line: string) => Effect.Effect<void, never>) | undefined,
  outputMode: "error" | "truncate" | "prefix",
  lineDelimiter: "\n" | "\0" = "\n",
  stop?: () => Effect.Effect<void>,
): Effect.fn.Return<CollectedGitOutput, GitCommandError> {
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let retainedBytes = 0;
  let text = "";
  let lineBuffer = "";
  let truncated = false;
  let retainedPrefixComplete = false;
  const findSeparator = () =>
    lineDelimiter === "\0" ? lineBuffer.indexOf("\0") : lineBuffer.search(/[\r\n]/);

  const appendRetainedPrefix = (decoded: string) => {
    if (retainedPrefixComplete || decoded.length === 0) return;
    const decodedBytes = Buffer.byteLength(decoded, "utf8");
    const remainingBytes = maxOutputBytes - retainedBytes;
    const retained =
      decodedBytes <= remainingBytes ? decoded : truncateUtf8Prefix(decoded, remainingBytes);
    const appendedBytes = retained === decoded ? decodedBytes : Buffer.byteLength(retained, "utf8");
    text += retained;
    retainedBytes += appendedBytes;
    if (appendedBytes < decodedBytes) {
      retainedPrefixComplete = true;
      truncated = true;
    }
  };

  const emitCompleteLines = (flush: boolean) =>
    Effect.gen(function* () {
      let separatorIndex = findSeparator();
      while (separatorIndex >= 0) {
        const line = lineBuffer.slice(0, separatorIndex);
        const separatorWidth =
          lineDelimiter !== "\0" &&
          lineBuffer[separatorIndex] === "\r" &&
          lineBuffer[separatorIndex + 1] === "\n"
            ? 2
            : 1;
        lineBuffer = lineBuffer.slice(separatorIndex + separatorWidth);
        if (line.length > 0 && onLine) {
          yield* onLine(line);
        }
        separatorIndex = findSeparator();
      }

      if (flush) {
        const trailing = lineDelimiter === "\0" ? lineBuffer : lineBuffer.replace(/\r$/, "");
        lineBuffer = "";
        if (trailing.length > 0 && onLine) {
          yield* onLine(trailing);
        }
      }
    });

  const boundedStream =
    outputMode === "prefix"
      ? stream.pipe(Stream.takeUntil(() => receivedBytes >= maxOutputBytes))
      : stream;
  yield* Stream.runForEach(boundedStream, (chunk) =>
    Effect.gen(function* () {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maxOutputBytes) {
        truncated = true;
        if (outputMode === "error") {
          return yield* new GitCommandError({
            operation: input.operation,
            command: commandLabel(input.args),
            cwd: input.cwd,
            detail: `${commandLabel(input.args)} output exceeded ${maxOutputBytes} bytes and was truncated.`,
          });
        }
      }

      if (outputMode !== "error" && retainedPrefixComplete && !onLine) {
        return;
      }
      const decoded = decoder.decode(chunk, { stream: true });
      appendRetainedPrefix(decoded);
      lineBuffer += decoded;
      yield* emitCompleteLines(false);
      if (outputMode !== "error" && lineBuffer.length > maxOutputBytes) {
        lineBuffer = lineBuffer.slice(-maxOutputBytes);
      }
    }),
  ).pipe(Effect.mapError(toGitCommandError(input, "output stream failed.")));

  if (outputMode === "prefix" && receivedBytes >= maxOutputBytes) {
    truncated = true;
    if (stop) yield* stop();
  }
  const remainder = decoder.decode();
  appendRetainedPrefix(remainder);
  lineBuffer += remainder;
  if (!(outputMode === "prefix" && truncated && lineDelimiter === "\0"))
    yield* emitCompleteLines(true);
  return { text, truncated };
});

const makeGitCommands = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const queue = new GitProcessQueue(6);
  const reads = yield* makeKeyedSingleFlightCache<ExecuteGitResult, GitCommandError>({
    maxEntries: 512,
    ttlMs: 0,
  });
  const withPermit = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    priority: "foreground" | "background" = "foreground",
  ) => queue.run(effect, priority);
  const executeProcess: GitCoreShape["execute"] = Effect.fnUntraced(function* (input) {
    const commandInput = {
      ...input,
      args: [...input.args],
    } as const;
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const outputMode = input.outputMode ?? "error";

    const commandEffect = Effect.gen(function* () {
      const trace2Monitor = yield* createTrace2Monitor(commandInput, input.progress).pipe(
        Effect.provideService(Path.Path, path),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.mapError(toGitCommandError(commandInput, "failed to create trace2 monitor.")),
      );
      const child = yield* commandSpawner
        .spawn(
          makeEffectProcessCommand("git", commandInput.args, {
            cwd: commandInput.cwd,
            env: {
              ...process.env,
              ...input.env,
              ...trace2Monitor.env,
            },
          }),
        )
        .pipe(Effect.mapError(toGitCommandError(commandInput, "failed to spawn.")));

      yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));

      const [stdoutResult, stderrResult, exitCode] = yield* Effect.all(
        [
          collectGitOutput(
            commandInput,
            child.stdout,
            maxOutputBytes,
            input.progress?.onStdoutLine,
            outputMode,
            input.progress?.stdoutLineDelimiter,
            () => child.kill().pipe(Effect.ignore),
          ),
          collectGitOutput(
            commandInput,
            child.stderr,
            maxOutputBytes,
            input.progress?.onStderrLine,
            outputMode,
          ),
          child.exitCode.pipe(
            Effect.map((value) => Number(value)),
            Effect.mapError(toGitCommandError(commandInput, "failed to report exit code.")),
          ),
        ],
        { concurrency: "unbounded" },
      );
      yield* trace2Monitor.flush;

      if (
        !input.allowNonZeroExit &&
        exitCode !== 0 &&
        !(outputMode === "prefix" && stdoutResult.truncated)
      ) {
        const trimmedStderr = stderrResult.text.trim();
        return yield* new GitCommandError({
          operation: commandInput.operation,
          command: commandLabel(commandInput.args),
          cwd: commandInput.cwd,
          detail:
            trimmedStderr.length > 0
              ? `${commandLabel(commandInput.args)} failed: ${trimmedStderr}`
              : `${commandLabel(commandInput.args)} failed with code ${exitCode}.`,
        });
      }

      return {
        code: exitCode,
        stdout: stdoutResult.text,
        stderr: stderrResult.text,
        stdoutTruncated: stdoutResult.truncated,
        stderrTruncated: stderrResult.truncated,
      } satisfies ExecuteGitResult;
    });

    return yield* commandEffect.pipe(
      Effect.scoped,
      Effect.timeoutOption(timeoutMs),
      Effect.flatMap((result) =>
        Option.match(result, {
          onNone: () =>
            Effect.fail(
              new GitCommandError({
                operation: commandInput.operation,
                command: commandLabel(commandInput.args),
                cwd: commandInput.cwd,
                detail: `${commandLabel(commandInput.args)} timed out.`,
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
  });

  const execute: GitCoreShape["execute"] = (input) => {
    const command = withPermit(executeProcess(input), input.priority);
    const readCommand = input.args[input.args[0] === "--no-optional-locks" ? 1 : 0];
    if (
      !COALESCED_READ_COMMANDS.has(readCommand ?? "") ||
      input.env ||
      input.progress ||
      (input.args[0] === "symbolic-ref" &&
        (input.args.includes("--delete") ||
          input.args.includes("-d") ||
          input.args.filter((arg) => !arg.startsWith("-")).length > 2))
    )
      return command;
    const key = JSON.stringify([
      input.cwd,
      input.args,
      input.allowNonZeroExit,
      input.timeoutMs,
      input.maxOutputBytes,
      input.outputMode,
    ]);
    return reads.get(key, command);
  };

  const executeGit = (
    operation: string,
    cwd: string,
    args: readonly string[],
    options: ExecuteGitOptions = {},
  ): Effect.Effect<ExecuteGitResult, GitCommandError> =>
    execute({
      operation,
      cwd,
      args,
      ...(options.priority ? { priority: options.priority } : {}),
      allowNonZeroExit: true,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.env ? { env: options.env } : {}),
      ...(options.progress ? { progress: options.progress } : {}),
      ...(options.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
      ...(options.outputMode !== undefined ? { outputMode: options.outputMode } : {}),
    }).pipe(
      Effect.flatMap((result) => {
        if (
          options.allowNonZeroExit ||
          result.code === 0 ||
          (options.outputMode === "prefix" && result.stdoutTruncated)
        ) {
          return Effect.succeed(result);
        }
        const stderr = result.stderr.trim();
        if (stderr.length > 0) {
          return Effect.fail(createGitCommandError(operation, cwd, args, stderr));
        }
        if (options.fallbackErrorMessage) {
          return Effect.fail(
            createGitCommandError(operation, cwd, args, options.fallbackErrorMessage),
          );
        }
        return Effect.fail(
          createGitCommandError(
            operation,
            cwd,
            args,
            `${commandLabel(args)} failed: code=${result.code ?? "null"}`,
          ),
        );
      }),
    );

  const runGit = (
    operation: string,
    cwd: string,
    args: readonly string[],
    allowNonZeroExit = false,
  ): Effect.Effect<void, GitCommandError> =>
    executeGit(operation, cwd, args, { allowNonZeroExit }).pipe(Effect.asVoid);

  const runGitStdout = (
    operation: string,
    cwd: string,
    args: readonly string[],
    allowNonZeroExit = false,
  ): Effect.Effect<string, GitCommandError> =>
    executeGit(operation, cwd, args, { allowNonZeroExit }).pipe(
      Effect.map((result) => result.stdout),
    );
  return { execute, executeGit, runGit, runGitStdout, withPermit };
});

export const GitCommandsLive = Layer.effect(GitCommands, makeGitCommands);
