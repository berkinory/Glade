import { useRef, type ReactNode } from "react";

import { useAnnouncementSheetSlot } from "./announcementSheetSlot";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

const ACTION_BUTTON_CLASS_NAME = "rounded-[10px] text-ui-lg sm:text-ui-lg";

export function AnnouncementSheet(props: {
  open: boolean;

  hero: ReactNode;
  title: ReactNode;

  description: ReactNode;
  // Optional structured content (rows, a status note) below the pitch. Kept out of the description
  // because that renders as a paragraph.
  details?: ReactNode;

  dismissLabel?: string;
  confirmLabel: string;

  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  const { open, handOff } = useAnnouncementSheetSlot(props.open);
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) props.onDismiss();
      }}
    >
      {}
      <DialogPopup
        showCloseButton={false}
        initialFocus={sheetRef}
        className="max-w-[420px] rounded-[20px]"
      >
        {}
        <div ref={sheetRef} tabIndex={-1} className="flex flex-col p-5 outline-none">
          <div aria-hidden className="mb-8 flex h-16 items-center">
            {props.hero}
          </div>

          <DialogHeader className="gap-2 p-0">
            <DialogTitle className="text-[19px] leading-tight">{props.title}</DialogTitle>
            <DialogDescription className="text-ui-lg leading-normal">
              {props.description}
            </DialogDescription>
          </DialogHeader>

          {props.details}

          <DialogFooter className="gap-2 p-0 pt-3">
            {props.dismissLabel !== undefined ? (
              <Button
                variant="ghost"
                className={ACTION_BUTTON_CLASS_NAME}
                onClick={props.onDismiss}
              >
                {props.dismissLabel}
              </Button>
            ) : null}
            <Button
              className={ACTION_BUTTON_CLASS_NAME}
              onClick={() => {
                handOff();
                props.onConfirm();
              }}
            >
              {props.confirmLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
