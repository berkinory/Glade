import { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { GladeRunDevServerInput } from "@glade/contracts/provider/agentGatewayTools";
import { Effect, Option, Schema, Semaphore } from "effect";
import type { DevServerManagerShape } from "../workspace/devServers/devServerManager";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery";
import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils";
import { mcpToolResultError, mcpToolResultJson, toolInputSchema } from "./protocol";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  WRITE_TOOL_ANNOTATIONS,
  type ToolEntry,
  type ToolContext,
} from "./toolRuntime";
import { errorText, ToolInputError } from "./toolInput";
import { workspaceRootsEqual } from "@glade/shared/threads/threadWorkspace";

export function makeDevServerTools(
  manager: DevServerManagerShape,
  snapshots: ProjectionSnapshotQueryShape,
): ReadonlyArray<ToolEntry> {
  const mutations = Semaphore.makeUnsafe(1);
  const workspace = (context: ToolContext) =>
    Effect.gen(function* () {
      const thread = yield* snapshots.getThreadShellById(
        ThreadId.makeUnsafe(context.callerThreadId),
      );
      if (Option.isNone(thread))
        return yield* Effect.fail(new ToolInputError("Caller thread not found."));
      const project = yield* snapshots.getProjectShellById(
        ProjectId.makeUnsafe(thread.value.projectId),
      );
      if (Option.isNone(project))
        return yield* Effect.fail(new ToolInputError("Caller project not found."));
      const cwd = resolveThreadWorkspaceCwd({ thread: thread.value, projects: [project.value] });
      if (!cwd) return yield* Effect.fail(new ToolInputError("Caller workspace is not ready."));
      return { thread: thread.value, project: project.value, cwd };
    });
  const empty = { type: "object", properties: {}, additionalProperties: false };
  return [
    {
      requiredCapability: "thread:read",
      definition: {
        name: "glade_list_dev_servers",
        description:
          "List Glade-managed dev servers with project, command, cwd, process id and lifecycle status. Running does not prove HTTP readiness; inspect the app before claiming it works.",
        inputSchema: empty,
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
      },
      handler: () => manager.list.pipe(Effect.map(mcpToolResultJson)),
    },
    ...(["run", "stop"] as const).map(
      (action): ToolEntry => ({
        requiredCapability: "thread:write",
        requiresActiveTurn: true,
        definition: {
          name: `glade_${action}_dev_server`,
          description:
            action === "run"
              ? "Start the caller workspace's Glade-managed dev server with command. Existing identical runs are reused. Refuses replacing a different run; stop it explicitly first. The project has one managed run shared by its threads. Starting a process does not prove HTTP readiness."
              : "Stop the caller project's Glade-managed dev server only if its cwd matches the caller workspace. Reports stopped:false when no run exists.",
          inputSchema: action === "run" ? toolInputSchema(GladeRunDevServerInput) : empty,
          annotations: WRITE_TOOL_ANNOTATIONS,
        },
        handler: (args, context) =>
          Effect.gen(function* () {
            const { project, thread, cwd } = yield* workspace(context);
            if (thread.runtimeMode !== "full-access")
              return yield* Effect.fail(
                new ToolInputError(
                  "Dev server mutations require a full-access caller; an approval-required agent cannot bypass shell approvals through Glade.",
                ),
              );
            const existing = (yield* manager.list).servers.find(
              (server) => server.projectId === project.id,
            );
            if (existing && !workspaceRootsEqual(existing.cwd, cwd))
              return yield* Effect.fail(
                new ToolInputError("This project's dev server belongs to another workspace."),
              );
            yield* context.assertCallerTurnActive();
            if (action === "stop")
              return mcpToolResultJson(yield* manager.stop({ projectId: project.id }));
            const { command } = Schema.decodeUnknownSync(GladeRunDevServerInput)(args);
            if (existing) {
              if (existing.command !== command)
                return yield* Effect.fail(
                  new ToolInputError(
                    "A different command is already running. Stop it explicitly first.",
                  ),
                );
              return mcpToolResultJson({ server: existing, reused: true });
            }
            return mcpToolResultJson(yield* manager.run({ projectId: project.id, command, cwd }));
          }).pipe(
            mutations.withPermit,
            Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error)))),
          ),
      }),
    ),
  ];
}
