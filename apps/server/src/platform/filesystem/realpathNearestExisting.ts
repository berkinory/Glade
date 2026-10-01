import { Effect, FileSystem, Path } from "effect";

// Resolve existing ancestors before appending missing segments so lazily created workspace paths
// retain the same canonical identity.
export const realpathNearestExisting = Effect.fn(function* (
  inputPath: string,
): Effect.fn.Return<string, never, FileSystem.FileSystem | Path.Path> {
  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;

  const resolvedInput = path.resolve(inputPath);
  const missingSegments: Array<string> = [];
  let candidate = resolvedInput;

  while (true) {
    const exists = yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false));
    if (exists) {
      const real = yield* fileSystem
        .realPath(candidate)
        .pipe(Effect.orElseSucceed(() => candidate));
      return missingSegments.length > 0 ? path.join(real, ...missingSegments) : real;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) {
      return resolvedInput;
    }
    missingSegments.unshift(path.basename(candidate));
    candidate = parent;
  }
});
