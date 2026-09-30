import { type ProviderKind, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { type ProviderOptions } from "../../providerModelOptions";
import { MenuRadioGroup, MenuRadioItem, MenuSub, MenuSubTrigger } from "../ui/menu";
import { ComposerEffortSliderCard } from "./ComposerEffortSliderCard";
import { ComposerPickerMenuSubPopup } from "./ComposerPickerMenuPopup";
import { COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME } from "./composerPickerStyles";
import {
  getComposerTraitSelection,
  planComposerEffortChange,
  resolveComposerTraitStatusLabel,
  supportsComposerFastModeControl,
} from "./composerTraits";
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
  const contextWindowTraitId = selection.contextWindowDescriptor?.id ?? "contextWindow";
  const contextWindowValue = selection.contextWindow ?? selection.defaultContextWindow ?? "";

  const usesEffortSlider = props.effortControl === "slider" && selection.effortLevels.length > 0;

  const rows: ReactNode[] = [];
  if (selection.thinkingEnabled !== null) {
    rows.push(
      <TraitRow
        key="thinking"
        label="Thinking"
        value={selection.thinkingEnabled ? "on" : "off"}
        valueLabel={selection.thinkingEnabled ? "On" : "Off"}
        options={[
          { value: "on", label: "On", isDefault: true },
          { value: "off", label: "Off" },
        ]}
        onValueChange={(value) => commitTrait({ thinking: value === "on" })}
      />,
    );
  }
  if (selection.contextWindowOptions.length > 1) {
    rows.push(
      <TraitRow
        key="context"
        label={selection.contextWindowDescriptor?.label ?? "Context"}
        value={contextWindowValue}
        valueLabel={
          selection.contextWindowOptions.find((option) => option.value === contextWindowValue)
            ?.label ?? contextWindowValue
        }
        options={selection.contextWindowOptions.map((option) => ({
          value: option.value,
          label: option.label,
          isDefault: option.value === selection.defaultContextWindow,
        }))}
        onValueChange={(value) => commitTrait({ [contextWindowTraitId]: value })}
      />,
    );
  }
  if (selection.effortLevels.length > 0 && !usesEffortSlider) {
    rows.push(
      <TraitRow
        key="effort"
        label="Effort"
        value={selection.effort ?? ""}
        valueLabel={resolveComposerTraitStatusLabel(selection) ?? ""}
        disabled={selection.ultrathinkPromptControlled}
        options={selection.effortLevels.map((option) => ({
          value: option.value,
          label: option.label,
          isDefault: option.value === selection.defaultEffort,
        }))}
        onValueChange={(value) => {
          const plan = planComposerEffortChange({ provider, selection, prompt, value });
          if (!plan) return;
          if (plan.kind === "prompt") {
            props.onPromptChange(plan.prompt);
            return;
          }
          commitTrait(plan.patch);
        }}
      />,
    );
  }
  if (supportsComposerFastModeControl(selection) && !usesEffortSlider) {
    rows.push(
      <TraitRow
        key="speed"
        label="Speed"
        value={selection.fastModeEnabled ? "on" : "off"}
        valueLabel={selection.fastModeEnabled ? "Fast" : "Standard"}
        options={[
          { value: "off", label: "Standard", isDefault: true },
          { value: "on", label: "Fast" },
        ]}
        onValueChange={(value) => commitTrait({ fastMode: value === "on" })}
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
