import { EllipsisIcon, SquarePenIcon, CornerDownRightIcon, Delete02Icon } from "~/lib/icons";
import type { QueuedComposerTurn } from "../../composerDraftDomain";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
type QueuedComposerActionsProps = {
  queuedTurn: QueuedComposerTurn;
  onSteer: (queuedTurn: QueuedComposerTurn) => void;
  onRemove: (queuedTurnId: string) => void;
  onEdit: (queuedTurn: QueuedComposerTurn) => void;
};
function QueuedComposerActions({
  queuedTurn,
  onSteer,
  onRemove,
  onEdit,
}: QueuedComposerActionsProps) {
  return (
    <div className="flex shrink-0 items-center gap-0">
      <Button variant="subtle" size="chip" onClick={() => void onSteer(queuedTurn)}>
        <CornerDownRightIcon />
        <span>Steer</span>
      </Button>
      <IconButton
        variant="ghost"
        size="icon-chip"
        label="Delete message"
        onClick={() => onRemove(queuedTurn.id)}
      >
        <Delete02Icon />
      </IconButton>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-chip"
              aria-label="Queued follow-up actions"
              className="[&_svg]:mx-0"
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="end" side="top" sideOffset={6}>
          <MenuItem className="gap-2" onClick={() => onEdit(queuedTurn)}>
            <SquarePenIcon className="size-3.5" aria-hidden />
            <span>Edit message</span>
          </MenuItem>
          <MenuItem className="gap-2" onClick={() => onRemove(queuedTurn.id)}>
            <Delete02Icon className="size-3.5" aria-hidden />
            <span>Delete message</span>
          </MenuItem>
        </ComposerPickerMenuPopup>
      </Menu>
    </div>
  );
}
export { QueuedComposerActions };
