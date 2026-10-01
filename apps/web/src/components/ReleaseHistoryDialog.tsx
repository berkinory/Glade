import { ChangelogAccordion } from "../whatsNew/ChangelogAccordion";
import { CHANGELOG_ENTRIES } from "../whatsNew/changelog";
import { sortReleasedEntriesByVersionDesc } from "../whatsNew/logic";
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

export interface ReleaseHistoryDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;

  readonly defaultExpandedVersion?: string | null;
}

export default function ReleaseHistoryDialog({
  open,
  onOpenChange,
  defaultExpandedVersion: defaultExpandedVersionProp,
}: ReleaseHistoryDialogProps) {
  const defaultExpandedVersion = defaultExpandedVersionProp ?? null;

  const sorted = sortReleasedEntriesByVersionDesc(CHANGELOG_ENTRIES);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg gap-0 p-0">
        <DialogHeader className="gap-1 p-4 pr-12">
          <DialogTitle className="text-base">Release history</DialogTitle>
          <DialogDescription className="text-ui leading-snug">
            Every curated release, newest first.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="max-h-[min(62vh,520px)] px-4 py-3">
          <ChangelogAccordion entries={sorted} defaultExpandedVersion={defaultExpandedVersion} />
        </DialogPanel>

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
