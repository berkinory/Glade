import { Brain03Icon, EnergyFilledIcon, LimitationIcon } from "~/lib/icons";
import { type ProviderKind, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import { type ProviderOptions } from "../../providerModelOptions";
import { MenuRadioGroup, MenuRadioItem, MenuSub, MenuSubTrigger } from "../ui/menu";
import { ComposerPickerMenuSubPopup } from "./ComposerPickerMenuPopup";
import { COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME } from "./composerPickerStyles";
import { getComposerTraitSelection } from "./composerTraits";
import { useComposerTraitCommit } from "./useComposerTraitCommit";
type TraitOption = {
  value: string;
  label: string;
  icon?: ReactNode;
};
function traitPriority(id: string, hasEffort: boolean): number {
  if (id === "thinking" && !hasEffort) return 0;
  if (id === "serviceTier" || id === "fastMode") return 1;
  return 2;
}
function TraitRow(props: {
  label: string;
  value: string;
  options: ReadonlyArray<TraitOption>;
  triggerIcon?: ReactNode;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  const selectedOption = props.options.find((option) => option.value === props.value);
  const [open, setOpen] = useState(false);
  return (
    <MenuSub open={open} onOpenChange={setOpen}>
      <MenuSubTrigger disabled={props.disabled ?? false}>
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span className="truncate">{props.label}</span>
          <span
            className={cn(
              "flex min-w-0 items-center gap-1.5",
              COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME,
            )}
          >
            {props.triggerIcon ?? selectedOption?.icon}
            <span className="truncate">{selectedOption?.label ?? props.value}</span>
          </span>
        </span>
      </MenuSubTrigger>
      <ComposerPickerMenuSubPopup>
        <MenuRadioGroup
          value={props.value}
          onValueChange={(value) => {
            props.onValueChange(value);
            setOpen(false);
          }}
        >
          {props.options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value} onClick={() => setOpen(false)}>
              {option.icon}
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </ComposerPickerMenuSubPopup>
    </MenuSub>
  );
}
export function ComposerModelPickerTraitRows(props: {
  provider: ProviderKind;
  threadId: ThreadId;
  model: string;
  runtimeModel: ProviderModelDescriptor | undefined;
  modelOptions: ProviderOptions | undefined;
  prompt: string;
}) {
  const { provider, threadId, model, modelOptions, prompt } = props;
  const selection = getComposerTraitSelection(
    provider,
    model,
    prompt,
    modelOptions,
    props.runtimeModel,
  );
  const commitTrait = useComposerTraitCommit({
    threadId,
    provider,
    model,
    modelOptions,
  });
  const rows: ReactNode[] = [];
  const effortDescriptor = selection.primarySelectDescriptor;
  if (effortDescriptor && selection.effortLevels.length > 0) {
    rows.push(
      <TraitRow
        key={effortDescriptor.id}
        label="Thinking"
        value={selection.effort ?? ""}
        options={selection.effortLevels}
        triggerIcon={<Brain03Icon className="size-3.5 shrink-0" />}
        onValueChange={(value) => commitTrait({ [effortDescriptor.id]: value })}
      />,
    );
  }
  const descriptors = selection.descriptors.toSorted(
    (left, right) =>
      traitPriority(left.id, effortDescriptor !== null) -
      traitPriority(right.id, effortDescriptor !== null),
  );
  for (const descriptor of descriptors) {
    if (descriptor === selection.primarySelectDescriptor) continue;
    const isAdaptiveThinking = descriptor.id === "thinking";
    const isSpeed = descriptor.id === "serviceTier" || descriptor.id === "fastMode";
    const defaultOption: TraitOption = {
      value: "__inherit__",
      label: isAdaptiveThinking ? "Auto" : "Default",
      ...(isSpeed
        ? {
            icon: <LimitationIcon className="size-3.5 shrink-0" />,
          }
        : {}),
    };
    if (isSpeed) {
      const fastOption =
        descriptor.type === "select"
          ? descriptor.options.find((option) => option.id === "priority" || option.id === "fast")
          : undefined;
      const fastValue = descriptor.type === "boolean" ? "on" : fastOption?.id;
      if (!fastValue) continue;
      const current = modelOptions?.[descriptor.id as keyof ProviderOptions];
      rows.push(
        <TraitRow
          key={descriptor.id}
          label="Speed"
          value={current === true || current === fastValue ? fastValue : "__inherit__"}
          options={[
            defaultOption,
            {
              value: fastValue,
              label: "Fast",
              icon: <EnergyFilledIcon className="size-3.5 shrink-0" />,
            },
          ]}
          onValueChange={(value) =>
            commitTrait({
              [descriptor.id]:
                descriptor.type === "boolean"
                  ? value === "on"
                  : value === "__inherit__"
                    ? undefined
                    : value,
            })
          }
        />,
      );
      continue;
    }
    const options: TraitOption[] =
      descriptor.type === "select"
        ? [
            defaultOption,
            ...descriptor.options.map((option) => ({
              value: option.id,
              label: option.label,
            })),
          ]
        : [
            defaultOption,
            {
              value: "on",
              label: "On",
            },
            {
              value: "off",
              label: "Off",
            },
          ];
    const current = modelOptions?.[descriptor.id as keyof ProviderOptions];
    const value =
      typeof current === "boolean"
        ? current
          ? "on"
          : "off"
        : typeof current === "string"
          ? current
          : "__inherit__";
    rows.push(
      <TraitRow
        key={descriptor.id}
        label={descriptor.label}
        triggerIcon={isAdaptiveThinking ? <Brain03Icon className="size-3.5 shrink-0" /> : undefined}
        value={value}
        options={options}
        onValueChange={(value) =>
          commitTrait({
            [descriptor.id]:
              value === "__inherit__"
                ? undefined
                : descriptor.type === "boolean"
                  ? value === "on"
                  : value,
          })
        }
      />,
    );
  }
  if (rows.length === 0) return null;
  return <div className="flex flex-col gap-px border-t border-border p-1">{rows}</div>;
}
