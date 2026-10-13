import { Effect, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { spawnEffectProcess } from "../../platform/effectProcessRuntime.ts";
import { isWindowsShellCommandMissingResult } from "../../platform/shell-command-detection.ts";
import type { CommandResult } from "./providerCliOutput.ts";

class ProviderHealthProbeError extends Error {
  readonly _tag = "ProviderHealthProbeError";
}

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  Stream.runFold(
    stream,
    () => "",
    (acc, chunk) => acc + new TextDecoder().decode(chunk),
  );

// Runs a short provider CLI probe. A Windows shell reporting a missing command fails like ENOENT so
// callers classify it as an uninstalled CLI.
export const runProviderCliCommand = (
  executable: string,
  args: ReadonlyArray<string>,
  options: { readonly env: NodeJS.ProcessEnv; readonly cwd?: string | undefined },
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawnEffectProcess(spawner, executable, args, {
      ...options,
      stdin: "ignore",
    });

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    return { stdout, stderr, code: exitCode } satisfies CommandResult;
  }).pipe(
    Effect.scoped,
    Effect.flatMap((result) =>
      isWindowsShellCommandMissingResult({ code: result.code, stderr: result.stderr })
        ? Effect.fail(new ProviderHealthProbeError(`spawn ${executable} ENOENT`))
        : Effect.succeed(result),
    ),
  );
