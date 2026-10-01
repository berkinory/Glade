import { type ProviderKind, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { type ProviderOptions } from "../../providerModelOptions";
import { MenuRadioGroup, MenuRadioItem, MenuSub, MenuSubTrigger } from "../ui/menu";
import { ComposerEffortSliderCard } from "./ComposerEffortSliderCard";
import { ComposerPickerMenuSubPopup } from "./ComposerPickerMenuPopup";
import { COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME } from "./composerPickerStyles";
import { getComposerTraitSelection } from "./composerTraits";
import { useComposerTraitCommit } from "./useComposerTraitCommit";

export type ComposerEffortControl = "menu" | "slider";

function TraitRow(props: {
  label: string;
  valueLabel: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string; isDefault?: boolean }>;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <MenuSub open={open} onOpenChange={setOpen}>
      <MenuSubTrigger disabled={props.disabled ?? false}>
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span className="truncate">{props.label}</span>
          <span className={cn("truncate", COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME)}>
            {props.valueLabel}
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
              {option.label}
              {option.isDefault ? " (default)" : ""}
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
  onPromptChange: (prompt: string) => void;

  effortControl: ComposerEffortControl;
}) {
  const { provider, threadId, model, modelOptions, prompt } = props;
  const selection = getComposerTraitSelection(
    provider,
    model,
    prompt,
    modelOptions,
    props.runtimeModel,
  );
  const commitTrait = useComposerTraitCommit({ threadId, provider, model, modelOptions });
  const usesEffortSlider = props.effortControl === "slider" && selection.effortLevels.length > 0;

  const rows: ReactNode[] = [];
  for (const descriptor of selection.descriptors) {
    if (
      usesEffortSlider &&
      (descriptor === selection.primarySelectDescriptor || descriptor.id === "fastMode")
    )
      continue;
    const options =
      descriptor.type === "select"
        ? [
            { value: "__inherit__", label: "Provider default" },
            ...descriptor.options.map((option) => ({ value: option.id, label: option.label })),
          ]
        : [
            { value: "__inherit__", label: "Provider default" },
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
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
        value={value}
        valueLabel={options.find((option) => option.value === value)?.label ?? value}
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
  if (rows.length === 0 && !usesEffortSlider) return null;
  return (
    <div className="flex flex-col gap-px border-t border-border p-1">
      {usesEffortSlider ? (
        <ComposerEffortSliderCard
          provider={provider}
          threadId={threadId}
          model={model}
          runtimeModel={props.runtimeModel}
          modelOptions={modelOptions}
          prompt={prompt}
          onPromptChange={props.onPromptChange}
        />
      ) : null}
      {rows}
    </div>
  );
}
