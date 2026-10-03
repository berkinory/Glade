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
        // Remote tags may share names with unrelated local tags, especially across forks.
        args: [
          "fetch",
          "--prune",
          "--no-tags",
          remote,
          `+refs/heads/*:refs/remotes/${remote}/*`,
          `+refs/tags/*:refs/glade/publication/${remote}/tags/*`,
        ],
      });
    }
  });
}
