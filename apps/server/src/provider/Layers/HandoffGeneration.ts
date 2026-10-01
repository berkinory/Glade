import { Effect, FileSystem, Layer, Path, Schema, type ServiceMap } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Semaphore from "effect/Semaphore";
import { ProviderValidationError } from "../core/Errors";
import { HandoffGeneration } from "../Services/HandoffGeneration";
import { generateCodexHandoff } from "../structuredGeneration/codexHandoff";
import { generateClaudeHandoff } from "../structuredGeneration/claudeHandoff";

export const HandoffGenerationLive = Layer.effect(
  HandoffGeneration,
  Effect.gen(function* () {
    const permits = yield* Semaphore.make(1);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const generate: ServiceMap.Service.Shape<typeof HandoffGeneration>["generate"] = (input) => {
      const failure = (cause: unknown) =>
        Schema.is(ProviderValidationError)(cause)
          ? cause
          : new ProviderValidationError({
              operation: "handoff.prepare",
              issue:
                "Destination handoff preparation failed or timed out. Retry preparation; the source and draft are intact.",
              cause,
            });
      const request =
        input.modelSelection.provider === "codex"
          ? generateCodexHandoff(input).pipe(Effect.mapError(failure))
          : generateClaudeHandoff(input).pipe(Effect.mapError(failure));
      return permits
        .withPermits(1)(
          Effect.scoped(request).pipe(
            Effect.timeout("3 minutes"),
            Effect.catchTag("TimeoutError", () =>
              Effect.fail(
                new ProviderValidationError({
                  operation: "handoff.prepare",
                  issue: `Destination ${input.modelSelection.provider === "codex" ? "Codex" : "Claude"} preparation exceeded the three-minute request deadline. Retry to reuse completed evidence passes; the source and draft are intact.`,
                }),
              ),
            ),
          ),
        )
        .pipe(
          Effect.mapError(failure),
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        );
    };
    return { generate };
  }),
);
