import { type MessageId, type TurnId } from "@glade/contracts/core/baseSchemas";
import { useCallback } from "react";

import type { MessagesTimelineProps } from "./timelineSupport";
import type { useTimelineStateController } from "./useTimelineStateController";
export function useTimelineActionsController({
  state,
  props,
}: {
  state: ReturnType<typeof useTimelineStateController>;
  props: MessagesTimelineProps;
}) {
  const {
    setExpandedFileChangesByTurnId,
    setEditingUserMessageId,
    setSubmittingEditedUserMessageId,
  } = state;
  const { onEditUserMessage } = props;

  const toggleFileChangesExpanded = useCallback(
    (turnId: TurnId) => {
      setExpandedFileChangesByTurnId((current) => ({
        ...current,
        [turnId]: !(current[turnId] ?? true),
      }));
    },
    [setExpandedFileChangesByTurnId],
  );

  const cancelUserMessageEdit = useCallback(() => {
    setEditingUserMessageId(null);
  }, [setEditingUserMessageId]);

  const startUserMessageEdit = useCallback(
    (messageId: MessageId) => {
      setEditingUserMessageId(messageId);
    },
    [setEditingUserMessageId],
  );

  const submitUserMessageEdit = useCallback(
    (messageId: MessageId, text: string) => {
      if (!onEditUserMessage) {
        return Promise.resolve();
      }
      const nextText = text.trim();
      if (!nextText) {
        return Promise.resolve();
      }
      setSubmittingEditedUserMessageId(messageId);

      return Promise.resolve(onEditUserMessage(messageId, nextText))
        .then((saved) => {
          if (saved) {
            cancelUserMessageEdit();
          }
        })
        .finally(() => {
          setSubmittingEditedUserMessageId(null);
        });
    },
    [cancelUserMessageEdit, onEditUserMessage, setSubmittingEditedUserMessageId],
  );
  return {
    toggleFileChangesExpanded,
    cancelUserMessageEdit,
    startUserMessageEdit,
    submitUserMessageEdit,
  } as const;
}
