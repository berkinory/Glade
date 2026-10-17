import type { GitBranch } from "@glade/contracts/git/git";
import { useId, useState } from "react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function NewWorktreeDialog({
  branches,
  initialBranch,
  localBranch,
  hasLocalChanges,
  copyLocalChanges,
  onOpenChange,
  onSelect,
}: {
  branches: readonly GitBranch[];
  initialBranch: string | null;
  localBranch: string | null;
  hasLocalChanges: boolean;
  copyLocalChanges: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (branch: string, copyChanges: boolean) => void;
}) {
  const fieldId = useId();
  const [branch, setBranch] = useState(initialBranch ?? branches[0]?.name ?? null);
  const [copyChanges, setCopyChanges] = useState(copyLocalChanges);
  const canCopyChanges = hasLocalChanges && branch === localBranch;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>New worktree</DialogTitle>
          <DialogDescription>
            Choose a base branch for a separate workspace. A new branch and folder are created when
            you send your first message.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (branch) onSelect(branch, copyChanges);
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor={fieldId} className="block text-ui font-medium">
                Base branch
              </label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger id={fieldId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {branches.map((item) => (
                    <SelectItem key={item.name} value={item.name}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            {canCopyChanges ? (
              <label className="flex items-center gap-2 text-ui">
                <Checkbox
                  checked={copyChanges}
                  onCheckedChange={(checked) => setCopyChanges(Boolean(checked))}
                />
                Copy uncommitted changes
              </label>
            ) : null}
            <DialogFooter variant="bare">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!branch}>
                Use new worktree
              </Button>
            </DialogFooter>
          </form>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
