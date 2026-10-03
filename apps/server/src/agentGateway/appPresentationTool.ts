import { GladeAppOpenInput } from "@glade/contracts/provider/agentGatewayTools";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import type { AppPresentationShape } from "./Services/AppPresentation";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery";
import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils";
import { isWorkspaceRootWithin } from "@glade/shared/threads/threadWorkspace";
import { mcpToolResultError, mcpToolResultJson, toolInputSchema } from "./protocol";
import { errorText, ToolInputError } from "./toolInput";
import type { ToolEntry } from "./toolRuntime";

export function makeAppPresentationTool(
  presentation: AppPresentationShape,
  snapshots: ProjectionSnapshotQueryShape,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): ToolEntry {
  return {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    definition: {
      name: "glade_open_in_app",
      description:
        "Open a file, Source Control diff or terminal in the caller's Glade conversation. Files and optional diff paths are workspace-relative; file line is one-based. A diff turnId selects that turn's checkpoint; omit it for current changes. Terminal opens the panel without executing commands. Returns success only after a connected UI confirms navigation and presentation state; content loading can still fail independently.",
      inputSchema: toolInputSchema(GladeAppOpenInput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        let target = Schema.decodeUnknownSync(GladeAppOpenInput)(args);
        const threadId = ThreadId.makeUnsafe(context.callerThreadId);
        const thread = yield* snapshots.getThreadShellById(threadId);
        if (Option.isNone(thread))
          return yield* Effect.fail(new ToolInputError("Caller thread not found."));
        if (target.kind === "diff" && target.turnId) {
          const turnId = target.turnId;
          const checkpoints = yield* snapshots.getThreadCheckpointContext(threadId);
          if (
            Option.isNone(checkpoints) ||
            !checkpoints.value.checkpoints.some((checkpoint) => checkpoint.turnId === turnId)
          )
            return yield* Effect.fail(new ToolInputError("No checkpoint exists for this turn."));
        }
        if ("path" in target && target.path !== undefined) {
          const project = yield* snapshots.getProjectShellById(thread.value.projectId);
          if (Option.isNone(project))
            return yield* Effect.fail(new ToolInputError("Project not found."));
          const cwd = resolveThreadWorkspaceCwd({
            thread: thread.value,
            projects: [project.value],
          });
          if (!cwd || path.isAbsolute(target.path))
            return yield* Effect.fail(
              new ToolInputError("Use a workspace-relative path in a ready workspace."),
            );
          const root = yield* fs.realPath(cwd);
          const requested = path.resolve(cwd, target.path);
          if (!isWorkspaceRootWithin(requested, cwd))
            return yield* Effect.fail(new ToolInputError("Path is outside the caller workspace."));
          let ancestor = requested;
          while (!(yield* fs.exists(ancestor))) ancestor = path.dirname(ancestor);
          const canonicalAncestor = yield* fs.realPath(ancestor);
          const resolved = path.resolve(canonicalAncestor, path.relative(ancestor, requested));
          if (!isWorkspaceRootWithin(resolved, root))
            return yield* Effect.fail(new ToolInputError("Path is outside the caller workspace."));
          if (target.kind === "file") {
            const stat = yield* fs.stat(resolved);
            if (stat.type !== "File")
              return yield* Effect.fail(new ToolInputError("The requested path is not a file."));
          }
          target = { ...target, path: path.relative(root, resolved).replaceAll("\\", "/") };
        }
        yield* context.assertCallerTurnActive();
        yield* presentation.open({ threadId, target });
        return mcpToolResultJson({ opened: true, threadId, target });
      }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
  };
}
