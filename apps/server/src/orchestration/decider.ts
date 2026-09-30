import { Effect } from "effect";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import { type SpaceAssignmentWorkspacePaths } from "./commandInvariants.ts";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { decideSpaceCommand } from "./commandDecisions/spaceDecisions";
import { decideProjectCommand } from "./commandDecisions/projectDecisions";
import { decideThreadLifecycleCommand } from "./commandDecisions/threadLifecycleDecisions";
import { decideTurnCommand } from "./commandDecisions/turnDecisions";
import { decideConversationCommand } from "./commandDecisions/conversationDecisions";
import { decideTranscriptCommand } from "./commandDecisions/transcriptDecisions";

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
  workspacePaths,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;

  readonly workspacePaths?: SpaceAssignmentWorkspacePaths | undefined;
}): Effect.fn.Return<
  Omit<OrchestrationEvent, "sequence"> | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
  OrchestrationCommandInvariantError
> {
  switch (command.type) {
    case "space.create":
    case "space.meta.update":
    case "space.reorder":
    case "space.delete":
    case "space.projects.assign":
      return yield* decideSpaceCommand({ command, readModel, workspacePaths });
    case "project.create":
    case "project.meta.update":
    case "project.delete":
      return yield* decideProjectCommand({ command, readModel, workspacePaths });
    case "thread.create":
    case "thread.handoff.create":
    case "thread.fork.create":
    case "thread.delete":
    case "thread.archive":
    case "thread.unarchive":
    case "thread.meta.update":
    case "thread.pinned-message.add":
    case "thread.pinned-message.remove":
    case "thread.pinned-message.done.set":
    case "thread.pinned-message.label.set":
    case "thread.runtime-mode.set":
    case "thread.session.stop":

    case "thread.session.set":
      return yield* decideThreadLifecycleCommand({ command, readModel, workspacePaths });
    case "thread.turn.start":
    case "thread.legacy-cache.abandon":
    case "thread.turn.dispatch-queued":
    case "thread.compact":
    case "thread.turn.interrupt":
    case "thread.task.stop":
    case "thread.task.background":
    case "thread.approval.respond":
    case "thread.user-input.respond":
      return yield* decideTurnCommand({ command, readModel, workspacePaths });
    case "thread.checkpoint.revert":
    case "thread.conversation.rollback":
    case "thread.message.edit-and-resend":
    case "thread.revert.complete":
    case "thread.conversation.rollback.complete":
      return yield* decideConversationCommand({ command, readModel, workspacePaths });
    case "thread.messages.import":
    case "thread.message.assistant.delta":
    case "thread.message.assistant.complete":
    case "thread.message.user.bind-turn":
    case "thread.message.user.set-turn-boundary":

    case "thread.turn.diff.complete":
    case "thread.activity.append":
      return yield* decideTranscriptCommand({ command, readModel, workspacePaths });
    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
