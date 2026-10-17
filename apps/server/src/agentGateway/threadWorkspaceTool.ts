import { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { GladeSetThreadWorkspaceInput } from "@glade/contracts/provider/agentGatewayTools";
import { isWorkspaceRootWithin, workspaceRootsEqual } from "@glade/shared/threads/threadWorkspace";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import type { GitCoreShape } from "../git/Services/GitCore";
import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery";
import { mcpToolResultError, mcpToolResultJson, toolInputSchema } from "./protocol";
import { errorText, ToolInputError } from "./toolInput";
import type { ToolEntry } from "./toolRuntime";

export function makeThreadWorkspaceTool(
  engine: OrchestrationEngineShape,
  snapshots: ProjectionSnapshotQueryShape,
  git: GitCoreShape,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): ToolEntry {
  const readGitPath = (cwd: string, flag: string) =>
    git
      .execute({
        operation: "agentGateway.workspace",
        cwd,
        args: ["rev-parse", "--path-format=absolute", flag],
      })
      .pipe(Effect.flatMap((result) => fs.realPath(result.stdout.replace(/\r?\n$/, ""))));

  return {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    definition: {
      name: "glade_set_thread_workspace",
      description:
        "Move the caller's Glade thread to an existing linked Git worktree in the same repository. Pass an absolute directory path, optionally inside the worktree. Updates Environment, Git/diff and new terminals immediately; the provider session uses it on the next turn. Does not create a worktree, move files, change the current tool process directory or retarget open terminals. Call after moving this thread's work into a worktree, not for temporary commands or subagent-only work. Report failure if the workspace could not be registered.",
      inputSchema: toolInputSchema(GladeSetThreadWorkspaceInput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(GladeSetThreadWorkspaceInput)(args);
        if (!path.isAbsolute(input.path))
          return yield* Effect.fail(new ToolInputError("Use an absolute directory path."));

        const threadId = ThreadId.makeUnsafe(context.callerThreadId);
        const thread = yield* snapshots.getThreadShellById(threadId);
        if (Option.isNone(thread))
          return yield* Effect.fail(new ToolInputError("Caller thread not found."));
        const project = yield* snapshots.getProjectShellById(thread.value.projectId);
        if (Option.isNone(project))
          return yield* Effect.fail(new ToolInputError("Project not found."));

        const workingDirectory = yield* fs.realPath(input.path);
        if ((yield* fs.stat(workingDirectory)).type !== "Directory")
          return yield* Effect.fail(new ToolInputError("The requested path is not a directory."));

        const [projectCommonDir, commonDir, gitDir, worktreePath] = yield* Effect.all([
          readGitPath(project.value.workspaceRoot, "--git-common-dir"),
          readGitPath(workingDirectory, "--git-common-dir"),
          readGitPath(workingDirectory, "--git-dir"),
          readGitPath(workingDirectory, "--show-toplevel"),
        ]);
        if (!workspaceRootsEqual(projectCommonDir, commonDir))
          return yield* Effect.fail(
            new ToolInputError("The worktree must belong to this thread's project repository."),
          );
        if (workspaceRootsEqual(gitDir, commonDir))
          return yield* Effect.fail(
            new ToolInputError("Choose a linked worktree, not the shared primary checkout."),
          );
        if (!isWorkspaceRootWithin(workingDirectory, worktreePath))
          return yield* Effect.fail(new ToolInputError("The directory is outside the worktree."));

        const { branch } = yield* git.readBranchContext(workingDirectory);
        const metadata = {
          envMode: "worktree" as const,
          worktreePath,
          workingDirectory,
          branch,
          associatedWorktreePath: worktreePath,
          associatedWorktreeBranch: branch,
          associatedWorktreeRef: branch,
        };
        yield* context.assertCallerTurnActive();
        yield* engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe(`agent:${crypto.randomUUID()}:workspace`),
          threadId,
          ...metadata,
          ...(!thread.value.worktreePath ||
          !workspaceRootsEqual(thread.value.worktreePath, worktreePath) ||
          thread.value.branch !== branch
            ? { lastKnownPr: null }
            : {}),
        });
        return mcpToolResultJson({ threadId, ...metadata });
      }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
  };
}
