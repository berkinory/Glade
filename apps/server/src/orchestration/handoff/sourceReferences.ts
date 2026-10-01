import type { MessageId } from "@glade/contracts/core/baseSchemas";
import type {
  OrchestrationMessage,
  OrchestrationThread,
} from "@glade/contracts/orchestration/threadEntities";

export function handoffMessageReference(
  source: OrchestrationThread,
  message: OrchestrationMessage,
  importedMessageId: MessageId,
  boundary: number,
) {
  const previous =
    message.source === "handoff-import"
      ? source.handoff?.sourceMessages?.find((entry) => entry.importedMessageId === message.id)
      : undefined;
  return {
    sourceMessageId: message.id,
    importedMessageId,
    originThreadId:
      previous?.originThreadId ?? (previous ? source.handoff!.sourceThreadId : source.id),
    originMessageId: previous?.originMessageId ?? previous?.sourceMessageId ?? message.id,
    originBoundarySequence:
      previous?.originBoundarySequence ??
      (previous ? source.handoff?.sourceBoundarySequence : boundary),
  };
}
