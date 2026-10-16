import type { ReactNode } from "react";

import { Book02Icon } from "~/lib/icons";
import { Switch } from "../../ui/switch";
import { ProviderStack } from "../ProviderStack";
import type { SkillGroup } from "./skills.logic";

export function SkillRow(props: {
  readonly group: SkillGroup;
  readonly enabled: boolean;
  readonly onEnabledChange: (enabled: boolean) => void;
  // A warning shown in place of the description.
  readonly note?: string | undefined;
  readonly action?: ReactNode;
}) {
  const { group } = props;
  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
      <span
        aria-hidden="true"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-[var(--color-background-elevated-secondary)] text-muted-foreground"
      >
        <Book02Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui font-medium text-foreground">
          {group.displayName}
        </span>
        <span
          className={
            props.note
              ? "block truncate text-ui-sm text-warning"
              : "block truncate text-ui-sm text-muted-foreground"
          }
          title={props.note ?? group.description}
        >
          {props.note ?? group.description}
        </span>
      </span>
      <ProviderStack providers={group.providers} />
      {props.action}
      <Switch
        checked={props.enabled}
        onCheckedChange={(checked) => props.onEnabledChange(Boolean(checked))}
        aria-label={`Use the ${group.displayName} skill`}
      />
    </div>
  );
}
