import { useEffect, useId, useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

export function CreateBranchDialog({
  open,
  onOpenChange,
  baseLabel,
  initialName,
  isNameTaken,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseLabel: string;
  initialName?: string;
  isNameTaken: (name: string) => boolean;
  onCreate: (name: string) => void;
}) {
  const fieldId = useId();
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName(initialName ?? "");
  }, [initialName, open]);
  const trimmed = name.trim();
  const taken = trimmed.length > 0 && isNameTaken(trimmed);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create branch</DialogTitle>
          <DialogDescription>
            {`Create a branch from ${baseLabel} and switch to it. It is published the first time you push.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!trimmed || taken) return;
              onOpenChange(false);
              onCreate(trimmed);
            }}
          >
            <div className="space-y-1.5">
              <label className="block font-medium text-ui leading-snug" htmlFor={fieldId}>
                Branch name
              </label>
              <Input
                autoFocus
                id={fieldId}
                placeholder="feature/my-change"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {taken ? (
              <p className="text-destructive text-ui leading-snug">
                A branch with this name already exists.
              </p>
            ) : null}
            <DialogFooter variant="bare">
              <Button variant="outline" size="sm" type="button" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!trimmed || taken}>
                Create and switch
              </Button>
            </DialogFooter>
          </form>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
