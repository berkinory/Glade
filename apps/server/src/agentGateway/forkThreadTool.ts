import type { OrchestrationEventStoreShape } from "../persistence/Services/OrchestrationEventStore";
import { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { GladeForkThreadInput } from "@glade/contracts/provider/agentGatewayTools";
import { Effect, Option, Schema, Semaphore } from "effect";
import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery";
import { runtimeModeEscalatesPrivilege } from "@glade/shared/threads/runtimeMode";
import { mcpToolResultError, mcpToolResultJson, toolInputSchema } from "./protocol";
import { stableGatewayDigest, gatewayIsoNow } from "./creationUtils";
import { errorText, ToolInputError } from "./toolInput";
import type { ToolEntry } from "./toolRuntime";

export function makeForkThreadTool(
  engine: OrchestrationEngineShape,
  snapshots: ProjectionSnapshotQueryShape,
  events: OrchestrationEventStoreShape,
): ToolEntry {
  const forks = Semaphore.makeUnsafe(1);
  return {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    definition: {
      name: "glade_fork_thread",
      description:
        "Fork an existing conversation at a completed native assistant messageId returned by glade_read_thread. Inherits the source provider/model, permissions and workspace, preserving native context without a summary. Returns an idle conversation; use glade_send_message to start work and glade_wait_for_threads for results. Reuse requestId with exactly the same source and message after an ambiguous response. Cannot drive higher-privileged or shared-local threads from an isolated caller.",
      inputSchema: toolInputSchema(GladeForkThreadInput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const input = Schema.decodeUnknownSync(GladeForkThreadInput)(args);
        const caller = yield* snapshots.getThreadShellById(
          ThreadId.makeUnsafe(context.callerThreadId),
        );
        const source = yield* snapshots.getThreadDetailById(input.threadId);
        if (Option.isNone(caller) || Option.isNone(source))
          return yield* Effect.fail(new ToolInputError("Caller or source thread not found."));
        const thread = source.value;
        if (
          runtimeModeEscalatesPrivilege(caller.value.runtimeMode, thread.runtimeMode) ||
          (caller.value.envMode === "worktree" && thread.envMode !== "worktree")
        )
          return yield* Effect.fail(
            new ToolInputError("Cannot fork a source with greater authority than the caller."),
          );
        const message = thread.messages.find((entry) => entry.id === input.messageId);
        if (!message || message.streaming || message.role !== "assistant")
          return yield* Effect.fail(new ToolInputError("Choose a completed assistant message."));
        const boundary =
          thread.modelSelection.provider === "codex" ? message.turnId : message.providerMessageId;
        if (!boundary)
          return yield* Effect.fail(
            new ToolInputError("This message has no native fork boundary."),
          );
        const id = stableGatewayDigest({
          callerThreadId: context.callerThreadId,
          requestId: input.requestId,
        });
        const threadId = ThreadId.makeUnsafe(`agent-fork-${id}`);
        const existing = yield* snapshots.getThreadShellById(threadId);
        if (Option.isSome(existing)) {
          const fork = existing.value;
          const expectedPoint =
            thread.modelSelection.provider === "codex"
              ? { provider: "codex", turnId: boundary }
              : { provider: "claudeAgent", messageId: boundary };
          const creationEvents = yield* events.readThreadEvents({
            threadId,
            throughSequenceInclusive: yield* events.getThreadHighWaterSequence(threadId),
            eventTypes: ["thread.created"],
            limit: 1,
          });
          const creation = creationEvents[0];
          if (
            fork.forkSourceThreadId !== thread.id ||
            creation?.type !== "thread.created" ||
            stableGatewayDigest(creation.payload.forkPoint) !== stableGatewayDigest(expectedPoint)
          )
            return yield* Effect.fail(
              new ToolInputError("requestId belongs to a different fork plan."),
            );
          return mcpToolResultJson({
            threadId,
            sourceThreadId: thread.id,
            status: "created",
            replayed: true,
          });
        }
        yield* context.assertCallerTurnActive();
        yield* engine.dispatch({
          type: "thread.fork.create",
          commandId: CommandId.makeUnsafe(`agent:${id}:fork`),
          threadId,
          sourceThreadId: thread.id,
          projectId: thread.projectId,
          title: thread.title,
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          envMode: thread.envMode ?? "local",
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          workingDirectory: thread.workingDirectory,
          associatedWorktreePath: thread.associatedWorktreePath,
          associatedWorktreeBranch: thread.associatedWorktreeBranch,
          associatedWorktreeRef: thread.associatedWorktreeRef,
          createBranchFlowCompleted: thread.createBranchFlowCompleted,
          forkMessageId: input.messageId,
          createdAt: gatewayIsoNow(),
        });
        return mcpToolResultJson({
          threadId,
          sourceThreadId: thread.id,
          status: "created",
          replayed: false,
        });
      }).pipe(
        forks.withPermit,
        Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error)))),
      ),
  };
}
