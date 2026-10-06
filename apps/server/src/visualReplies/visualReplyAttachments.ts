import { Effect, Option, Schema } from "effect";
import {
  VisualReply,
  VISUAL_REPLY_ACTIVITY_KIND,
  VISUAL_REPLY_MAX_DOCUMENT_BYTES,
} from "@glade/contracts/orchestration/visualReply";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { ManagedAttachmentRepositoryShape } from "../persistence/Services/ManagedAttachments";
import type { ManagedAttachmentPrincipal } from "../attachments/managedAttachmentPrincipal";
import { OrchestrationCommandInvariantError } from "../orchestration/Errors";

export function visualReplyAttachmentIds(payload: unknown): readonly string[] {
  const reply = Schema.decodeUnknownOption(VisualReply)(payload);
  return Option.isNone(reply)
    ? []
    : [
        reply.value.attachmentId,
        ...(reply.value.previewAttachmentId ? [reply.value.previewAttachmentId] : []),
      ];
}

export function claimVisualReplyAttachments(input: {
  readonly command: Extract<OrchestrationCommand, { type: "thread.activity.append" }>;
  readonly principal: ManagedAttachmentPrincipal;
  readonly repository: ManagedAttachmentRepositoryShape;
}) {
  return Effect.gen(function* () {
    const { command, principal, repository } = input;
    if (command.activity.kind !== VISUAL_REPLY_ACTIVITY_KIND) return;
    const invalid = (detail: string) =>
      new OrchestrationCommandInvariantError({ commandType: command.type, detail });
    const reply = yield* Schema.decodeUnknownEffect(VisualReply)(command.activity.payload).pipe(
      Effect.mapError(() => invalid("Invalid visual reply payload.")),
    );
    if (reply.threadId !== command.threadId)
      return yield* invalid("Visual reply belongs to another thread.");
    const attachmentIds = visualReplyAttachmentIds(reply);
    const now = new Date().toISOString();
    for (const [index, attachmentId] of attachmentIds.entries()) {
      const row = yield* repository.findServerOwned({
        attachmentId,
        ownerThreadId: command.threadId,
        ...principal,
        now,
      });
      if (Option.isNone(row))
        return yield* invalid(
          "Visual reply attachment is unavailable or belongs to another owner.",
        );
      const blob = row.value;
      if (
        blob.purpose !== (index === 0 ? "visual-reply" : "visual-reply-preview") ||
        blob.mimeType !== (index === 0 ? "text/html" : "image/png") ||
        blob.sizeBytes === null ||
        blob.sizeBytes > VISUAL_REPLY_MAX_DOCUMENT_BYTES
      )
        return yield* invalid("Invalid visual reply attachment metadata.");
    }
    const claim = yield* repository.claimForAcceptedTurn({
      attachmentIds,
      ownerThreadId: command.threadId,
      ...principal,
      commandId: command.commandId,
      messageId: command.activity.id,
      now,
    });
    if (claim.status !== "claimed")
      return yield* invalid(`Visual reply attachment claim was rejected: ${claim.reason}.`);
  });
}
