import { Effect, Option } from "effect";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import {
  copyClaimedManagedAttachment,
  isManagedAttachmentId,
  ManagedAttachmentStoreError,
} from "../attachments/managedAttachmentStore";
import type { ManagedAttachmentPrincipal } from "../attachments/managedAttachmentPrincipal";
import type { ManagedAttachmentRepositoryShape } from "../persistence/Services/ManagedAttachments";
import { visualReplyAttachmentIds } from "../visualReplies/visualReplyAttachments";
import { OrchestrationCommandInternalError, OrchestrationCommandInvariantError } from "./Errors";
import { type ForkImport, forkAttachmentId, forkImportSourceAttachmentIds } from "./forkImport";

type ForkCommand = Extract<OrchestrationCommand, { type: "thread.fork.create" }>;

// Runs during preparation, outside the commit transaction. Copies stay staged until the commit
// claims them, so an abandoned fork leaves only rows that the staging expiry already cleans up.
export function stageForkAttachmentCopies(input: {
  readonly command: ForkCommand;
  readonly forkImport: ForkImport;
  readonly attachmentsDir: string;
  readonly principal: ManagedAttachmentPrincipal;
  readonly repository: ManagedAttachmentRepositoryShape;
}) {
  const { command, principal, repository } = input;
  const invalid = (detail: string) =>
    new OrchestrationCommandInvariantError({ commandType: command.type, detail });
  return Effect.forEach(
    forkImportSourceAttachmentIds(input.forkImport),
    (sourceAttachmentId) =>
      Effect.gen(function* () {
        const attachmentId = forkAttachmentId(command.threadId, sourceAttachmentId);
        const now = new Date().toISOString();
        const staged = yield* repository.findServerOwned({
          attachmentId,
          ownerThreadId: command.threadId,
          ...principal,
          now,
        });
        if (Option.isSome(staged)) return;
        const source = yield* repository.findClaimedById({ attachmentId: sourceAttachmentId });
        if (Option.isNone(source) || source.value.ownerThreadId !== command.sourceThreadId)
          return yield* invalid(
            "An attachment in the source conversation is no longer available, so it cannot be forked.",
          );
        yield* copyClaimedManagedAttachment({
          source: source.value,
          attachmentId,
          ownerThreadId: command.threadId,
          attachmentsDir: input.attachmentsDir,
          now,
          principal,
          repository,
        }).pipe(
          Effect.mapError((error) =>
            error instanceof ManagedAttachmentStoreError && error.status < 500
              ? invalid(`Could not copy an attachment into the fork: ${error.message}`)
              : new OrchestrationCommandInternalError({
                  commandId: command.commandId,
                  commandType: command.type,
                  detail: `Could not copy an attachment into the fork: ${error.message}`,
                }),
          ),
        );
      }),
    { discard: true },
  );
}

function claimedAttachmentIds(event: OrchestrationEvent) {
  switch (event.type) {
    case "thread.message-sent":
      return {
        claimMessageId: event.payload.messageId,
        attachmentIds: (event.payload.attachments ?? []).flatMap((attachment) =>
          attachment.type !== "assistant-selection" && isManagedAttachmentId(attachment.id)
            ? [attachment.id]
            : [],
        ),
      };
    case "thread.activity-appended":
      return {
        claimMessageId: event.payload.activity.id,
        attachmentIds: visualReplyAttachmentIds(event.payload.activity.payload),
      };
    default:
      return null;
  }
}

// Runs inside the commit transaction, binding each staged copy to the imported message or visual
// reply that references it.
export function claimForkAttachmentCopies(input: {
  readonly command: ForkCommand;
  readonly events: ReadonlyArray<OrchestrationEvent>;
  readonly principal: ManagedAttachmentPrincipal;
  readonly repository: ManagedAttachmentRepositoryShape;
}) {
  const { command, principal, repository } = input;
  return Effect.forEach(
    input.events,
    (event) =>
      Effect.gen(function* () {
        const claim = claimedAttachmentIds(event);
        if (!claim || claim.attachmentIds.length === 0) return;
        const result = yield* repository.claimForAcceptedTurn({
          attachmentIds: claim.attachmentIds,
          ownerThreadId: command.threadId,
          ...principal,
          commandId: command.commandId,
          messageId: claim.claimMessageId,
          now: new Date().toISOString(),
        });
        if (result.status !== "claimed")
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Fork attachment claim was rejected: ${result.reason}.`,
          });
      }),
    { discard: true },
  );
}
