import type { ReactNode } from "react";

import { Book02Icon } from "~/lib/icons";
import { Switch } from "../../ui/switch";
import { ProviderStack } from "../ProviderStack";
import { SettingsTile } from "../SettingsTile";
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
      <SettingsTile>
        <Book02Icon />
      </SettingsTile>
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
