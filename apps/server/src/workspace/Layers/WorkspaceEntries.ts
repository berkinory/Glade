import { Effect, Layer } from "effect";

import {
  browseWorkspaceEntries,
  clearWorkspaceIndexCache,
  listWorkspaceDirectories,
  prewarmWorkspaceSearchIndex,
  resolveWorkspaceFileBySuffix,
  resolveWorkspaceFileReferences,
  searchLocalEntries,
  searchWorkspaceContent,
  searchWorkspaceEntries,
  type WorkspaceGitRunner,
} from "../workspaceEntries";
import { GitCommands } from "../../git/Services/GitCommands";
import { GitCommandsLive } from "../../git/Layers/GitCommands";
import { runProcess } from "../../platform/processRunner";
import { toWorkspaceEntriesError, WorkspaceEntries } from "../Services/WorkspaceEntries";

export const WorkspaceEntriesLive = Layer.effect(
  WorkspaceEntries,
  Effect.gen(function* () {
    const { withPermit } = yield* GitCommands;
    const runWithServices = Effect.runPromiseWith(yield* Effect.services<never>());
    const runGit: WorkspaceGitRunner = (args, options) =>
      runWithServices(
        withPermit(
          Effect.tryPromise({
            try: (signal) => runProcess("git", args, { ...options, signal }),
            catch: (cause) => toWorkspaceEntriesError("run workspace Git command", cause),
          }),
          "background",
        ),
      );
    return {
      browse: (input) =>
        Effect.tryPromise({
          try: () => browseWorkspaceEntries(input),
          catch: (cause) => toWorkspaceEntriesError("browse filesystem", cause),
        }),
      search: (input) =>
        Effect.tryPromise({
          try: () => searchWorkspaceEntries(input, runGit),
          catch: (cause) => toWorkspaceEntriesError("search workspace entries", cause),
        }),
      searchContent: (input) =>
        Effect.tryPromise({
          try: () => searchWorkspaceContent(input, runGit),
          catch: (cause) => toWorkspaceEntriesError("search workspace content", cause),
        }),
      prewarmSearchIndex: (input) => Effect.sync(() => prewarmWorkspaceSearchIndex(input, runGit)),
      listDirectories: (input) =>
        Effect.tryPromise({
          try: () => listWorkspaceDirectories(input, runGit),
          catch: (cause) => toWorkspaceEntriesError("list workspace directories", cause),
        }),
      searchLocal: (input) =>
        Effect.tryPromise({
          try: () => searchLocalEntries(input),
          catch: (cause) => toWorkspaceEntriesError("search local entries", cause),
        }),
      resolveFileBySuffix: (input) =>
        Effect.tryPromise({
          try: () => resolveWorkspaceFileBySuffix(input, runGit),
          catch: (cause) => toWorkspaceEntriesError("resolve workspace file by suffix", cause),
        }),
      resolveFileReferences: (input) =>
        Effect.tryPromise({
          try: () => resolveWorkspaceFileReferences(input, runGit),
          catch: (cause) => toWorkspaceEntriesError("resolve workspace file references", cause),
        }),
      invalidate: (cwd) => Effect.sync(() => clearWorkspaceIndexCache(cwd)),
    };
  }),
).pipe(Layer.provide(GitCommandsLive));
