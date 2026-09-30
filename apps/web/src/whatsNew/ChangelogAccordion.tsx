import { useState } from "react";

import { pluralize } from "@glade/shared/text/text";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { cn } from "~/lib/utils";

import { ReleaseNotesSections } from "./ReleaseNotesSections";
import type { WhatsNewEntry } from "./logic";

export interface ChangelogAccordionProps {
  readonly entries: readonly WhatsNewEntry[];

  readonly defaultExpandedVersion?: string | null;
  readonly className?: string;
}

export function ChangelogAccordion({
  entries,
  defaultExpandedVersion: defaultExpandedVersionProp,
  className,
}: ChangelogAccordionProps) {
  const defaultExpandedVersion = defaultExpandedVersionProp ?? null;
  if (entries.length === 0) {
    return (
      <p className={cn("text-ui leading-snug text-muted-foreground", className)}>
        No release notes yet — check back after the next update.
      </p>
    );
  }

  return (
    <ul className={cn("flex flex-col", className)}>
      {entries.map((entry, index) => (
        <ChangelogAccordionRow
          key={entry.version}
          entry={entry}
          defaultOpen={entry.version === defaultExpandedVersion}
          isLast={index === entries.length - 1}
        />
      ))}
    </ul>
  );
}

function ChangelogAccordionRow({
  entry,
  defaultOpen,
  isLast,
}: {
  readonly entry: WhatsNewEntry;
  readonly defaultOpen: boolean;
  readonly isLast: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const featureCount = entry.features.length;
  const featureLabel = `${featureCount} ${pluralize(featureCount, "update")}`;

  return (
    <li className={cn(!isLast && "border-b border-border/40")}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex w-full items-center gap-3 py-3 text-left">
          <DisclosureChevron open={open} />
          <span className="flex flex-1 items-baseline gap-2">
            <span className="text-ui leading-snug text-muted-foreground">{entry.date}</span>
            <span className="text-ui-lg font-semibold text-foreground">
              Version {entry.version}
            </span>
            <span className="text-ui leading-snug text-muted-foreground/70">({featureLabel})</span>
          </span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="pb-5 pl-6 pr-1">
            <ReleaseNotesSections features={entry.features} />
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}
