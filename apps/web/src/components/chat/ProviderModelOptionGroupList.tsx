import { useState } from "react";
import type { ProviderKind } from "@glade/contracts";
import { cn } from "~/lib/utils";
import {
  resolveModelGroupDefaultOpen,
  shouldUseCollapsibleModelGroups,
  type ProviderModelOptionGroup,
} from "../../providerModelOptions";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { MenuGroup, MenuGroupLabel, MenuRadioItem } from "../ui/menu";
import { COMPOSER_PICKER_MODEL_GROUP_HEADER_CLASS_NAME } from "./composerPickerStyles";

type Props = {
  groupedOptions: ReadonlyArray<ProviderModelOptionGroup>;
  provider: ProviderKind;
  activeModel: string;
  isSearching: boolean;
  onAfterSelection?: () => void;
};

function CollapsibleModelGroup(props: {
  group: ProviderModelOptionGroup;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="px-0.5">
      <CollapsibleTrigger
        className={cn(COMPOSER_PICKER_MODEL_GROUP_HEADER_CLASS_NAME, open && "text-foreground/75")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <DisclosureChevron open={open} className="col-start-1 size-3 shrink-0 opacity-50" />
        <span className="col-start-2 min-w-0 truncate normal-case tracking-normal">
          {props.group.label}
        </span>
        <span className="col-start-3 shrink-0 justify-self-end rounded-full bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] px-1.5 py-px text-ui-2xs font-normal tabular-nums normal-case tracking-normal text-muted-foreground/70">
          {props.group.options.length}
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel className="flex flex-col gap-px pb-0.5">{props.children}</CollapsiblePanel>
    </Collapsible>
  );
}

export function ProviderModelOptionGroupList(props: Props) {
  const useCollapsibleGroups = shouldUseCollapsibleModelGroups(
    props.groupedOptions.length,
    props.isSearching,
  );
  return (
    <div className="flex flex-col gap-px">
      {props.groupedOptions.map((group) => {
        const groupItems = group.options.map((model) => (
          <MenuRadioItem
            key={`${props.provider}:${model.slug}`}
            value={model.slug}
            onClick={() => props.onAfterSelection?.()}
          >
            {model.name}
          </MenuRadioItem>
        ));
        if (group.label === null) {
          return (
            <MenuGroup
              key={`${props.provider}:${group.key}`}
              className="flex flex-col gap-px px-0.5"
            >
              {groupItems}
            </MenuGroup>
          );
        }
        if (useCollapsibleGroups) {
          return (
            <CollapsibleModelGroup
              key={`${props.provider}:${group.key}`}
              group={group}
              defaultOpen={resolveModelGroupDefaultOpen({
                groupKey: group.key,
                options: group.options,
                activeModel: props.activeModel,
                groupCount: props.groupedOptions.length,
              })}
            >
              {groupItems}
            </CollapsibleModelGroup>
          );
        }
        return (
          <MenuGroup key={`${props.provider}:${group.key}`} className="flex flex-col gap-px px-0.5">
            <MenuGroupLabel>{group.label}</MenuGroupLabel>
            {groupItems}
          </MenuGroup>
        );
      })}
    </div>
  );
}
