import { useEffect, useId, useRef, useState } from "react";

import type { ProjectAppearance } from "~/lib/projectAppearance";
import { PROJECT_DIALOG_FIELD_CONTROL_CLASS_NAME } from "./CreateGitHubProjectFields";
import { ProjectAppearancePicker } from "./ProjectAppearancePicker";
import { ProjectSidebarIcon } from "./ProjectSidebarIcon";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";

export interface EditProjectValue {
  readonly name: string;
  readonly appearance: ProjectAppearance | null;
}

export interface EditProjectDialogProps {
  open: boolean;
  cwd: string;

  folderName: string;
  initialValue: EditProjectValue;
  onOpenChange: (open: boolean) => void;
  onSave: (value: EditProjectValue) => void;
}

export function EditProjectDialog({
  open,
  cwd,
  folderName,
  initialValue,
  onOpenChange,
  onSave,
}: EditProjectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>
        {}
        <EditProjectForm
          cwd={cwd}
          folderName={folderName}
          initialValue={initialValue}
          onOpenChange={onOpenChange}
          onSave={onSave}
        />
      </DialogPopup>
    </Dialog>
  );
}

function EditProjectForm({
  cwd,
  folderName,
  initialValue,
  onOpenChange,
  onSave,
}: Omit<EditProjectDialogProps, "open">) {
  const [name, setName] = useState(initialValue.name);
  const [appearance, setAppearance] = useState(initialValue.appearance);
  const [pickerOpen, setPickerOpen] = useState(false);
  const nameInputId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const nameInput = document.getElementById(nameInputId);
      if (nameInput instanceof HTMLInputElement) {
        nameInput.focus();
        nameInput.select();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nameInputId]);

  const save = () => {
    onSave({ name: name.trim(), appearance });
    onOpenChange(false);
  };

  return (
    <>
      <DialogPanel>
        {}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            {}
            <InputGroup className={PROJECT_DIALOG_FIELD_CONTROL_CLASS_NAME}>
              <InputGroupAddon className="w-10 self-stretch border-e border-foreground/12 ps-0 has-[>button]:ms-0">
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Choose icon"
                      className="flex size-full cursor-pointer items-center justify-center rounded-s-[inherit] text-muted-foreground outline-hidden transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/6 data-popup-open:bg-foreground/6"
                    />
                  }
                >
                  <span className="relative flex size-4 items-center justify-center">
                    <ProjectSidebarIcon cwd={cwd} expanded={false} appearance={appearance} />
                  </span>
                </PopoverTrigger>
              </InputGroupAddon>
              <InputGroupInput
                id={nameInputId}
                aria-label="Project name"
                value={name}
                placeholder={folderName}
                onChange={(event) => setName(event.target.value)}
              />
            </InputGroup>
          </form>
          <PopoverPopup
            align="start"
            side="bottom"
            sideOffset={8}
            initialFocus={searchInputRef}
            className="w-[22.5rem] bg-popover"
          >
            <ProjectAppearancePicker
              value={appearance}
              searchInputRef={searchInputRef}
              onChange={setAppearance}
              onEmojiPicked={() => setPickerOpen(false)}
            />
          </PopoverPopup>
        </Popover>
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button size="sm" onClick={save}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
