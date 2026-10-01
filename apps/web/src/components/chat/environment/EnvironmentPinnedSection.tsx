import type { MessageId } from "@glade/contracts/core/baseSchemas";
import type { PinnedMessage } from "@glade/contracts/orchestration/threadEntities";
import { displayLabelFor } from "~/pinnedMessages";

import { EnvironmentEditableMessageRow } from "./EnvironmentEditableMessageRow";
import { EnvironmentCollapsibleSection } from "./EnvironmentRow";

interface EnvironmentPinnedSectionProps {
  pins: readonly PinnedMessage[];

  messageTextById: ReadonlyMap<MessageId, string>;
  onJump: (messageId: MessageId) => void;
  onUnpin: (messageId: MessageId) => void;
  onRename: (messageId: MessageId, label: string | null) => void;
}

export function EnvironmentPinnedSection({
  pins,
  messageTextById,
  onJump,
  onUnpin,
  onRename,
}: EnvironmentPinnedSectionProps) {
  if (pins.length === 0) {
    return null;
  }
  return (
    <EnvironmentCollapsibleSection label="Pinned">
      <ul className="flex flex-col">
        {pins.map((pin) => (
          <PinnedMessageRow
            key={pin.messageId}
            pin={pin}
            text={messageTextById.get(pin.messageId)}
            onJump={onJump}
            onUnpin={onUnpin}
            onRename={onRename}
          />
        ))}
      </ul>
    </EnvironmentCollapsibleSection>
  );
}

const PinnedMessageRow = function PinnedMessageRow({
  pin,
  text,
  onJump,
  onUnpin,
  onRename,
}: {
  pin: PinnedMessage;
  text: string | undefined;
  onJump: (messageId: MessageId) => void;
  onUnpin: (messageId: MessageId) => void;
  onRename: (messageId: MessageId, label: string | null) => void;
}) {
  const available = text !== undefined;
  const resolvedLabel = displayLabelFor(pin, text);
  const displayLabel = resolvedLabel.length > 0 ? resolvedLabel : "(message unavailable)";

  return (
    <EnvironmentEditableMessageRow
      available={available}
      displayLabel={displayLabel}
      initialEditLabel={resolvedLabel}
      editPlaceholder={available ? "" : "Label"}
      labelAriaLabel={
        available
          ? "Jump to pinned message. Press F2 to rename."
          : "Pinned message unavailable. Press Enter to rename."
      }
      labelTitle={
        available
          ? "Click to jump · double-click or press F2 to rename"
          : "Click or press Enter to rename"
      }
      removeLabel="Unpin message"
      removeTooltip="Unpin"
      className="group/pin"
      removeButtonClassName="group-hover/pin:opacity-100"
      onJump={() => onJump(pin.messageId)}
      onRemove={() => onUnpin(pin.messageId)}
      onRename={(label) => onRename(pin.messageId, label)}
    />
  );
};
