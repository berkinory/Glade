import { type ProviderKind, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { useState, type ReactNode } from "react";

import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";
import { type ProviderOptions } from "../../providerModelOptions";
import { MenuRadioGroup, MenuRadioItem, MenuSub, MenuSubTrigger } from "../ui/menu";
import { ComposerEffortSliderCard } from "./ComposerEffortSliderCard";
import { ComposerPickerMenuSubPopup } from "./ComposerPickerMenuPopup";
import { COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME } from "./composerPickerStyles";
import { getComposerTraitSelection } from "./composerTraits";
import { useComposerTraitCommit } from "./useComposerTraitCommit";

type TraitOption = { value: string; label: string; isDefault?: boolean; icon?: string };

function TraitRow(props: {
  label: string;
  value: string;
  options: ReadonlyArray<TraitOption>;
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
            {selectedOption?.icon ? (
              <CentralIcon
                name={selectedOption.icon}
                variant={selectedOption.icon === "zap" ? "fill" : "reversed"}
                className="size-3.5 shrink-0"
              />
            ) : null}
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
              {option.icon ? (
                <CentralIcon
                  name={option.icon}
                  variant={option.icon === "zap" ? "fill" : "reversed"}
                  className="size-3.5 shrink-0"
                />
              ) : null}
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
  const usesEffortSlider = selection.effortLevels.length > 0;

  const rows: ReactNode[] = [];
  for (const descriptor of selection.descriptors) {
    if (descriptor === selection.primarySelectDescriptor) continue;
    const isAdaptiveThinking = descriptor.id === "thinking";
    const isSpeed = descriptor.id === "serviceTier" || descriptor.id === "fastMode";
    const defaultOption: TraitOption = {
      value: "__inherit__",
      label: isAdaptiveThinking ? "Auto" : "Default",
      ...(isSpeed ? { icon: "gauge" } : isAdaptiveThinking ? { icon: "brain" } : {}),
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
          options={[defaultOption, { value: fastValue, label: "Fast", icon: "zap" }]}
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
            ...descriptor.options.map((option) => ({ value: option.id, label: option.label })),
          ]
        : [
            defaultOption,
            { value: "on", label: "On", ...(isAdaptiveThinking ? { icon: "brain" } : {}) },
            { value: "off", label: "Off", ...(isAdaptiveThinking ? { icon: "brain" } : {}) },
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
      {rows}
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
    </div>
  );
}
