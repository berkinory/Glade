import { Effect } from "effect";
import type { GitCoreShape } from "./Services/GitCore";

export function refreshPublicationRefs(cwd: string, execute: GitCoreShape["execute"]) {
  return Effect.gen(function* () {
    const remotes = yield* execute({ cwd, operation: "check publication", args: ["remote"] });
    // Configured fetch refspecs can omit published branches. Inspect all heads before rewriting.
    for (const remote of remotes.stdout.trim().split("\n").filter(Boolean)) {
      yield* execute({
        cwd,
        operation: "check publication",
        timeoutMs: 120_000,
        args: ["fetch", "--prune", "--tags", remote, `+refs/heads/*:refs/remotes/${remote}/*`],
      });
    }
  });
}
