import { Brain03Icon, ChevronDownIcon, EnergyFilledIcon, SettingsIcon } from "~/lib/icons";
import { CLAUDE_FAST_MODE_BILLING_NOTE } from "~/lib/fastModeStatus";
import { type ProviderKind, type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ProviderOptionDescriptor } from "@glade/contracts/provider/model";
import { type ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { Fragment } from "react";
import { cn } from "~/lib/utils";
import { type ProviderOptions } from "../../providerModelOptions";
import { Button } from "../ui/button";
import { ShortcutKbd } from "../ui/kbd";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import {
  COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME,
  COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
} from "./composerPickerStyles";
import {
  getComposerTraitSelection,
  resolveComposerModelOptions,
  resolveComposerTraitsSummary,
} from "./composerTraits";
import { PICKER_PANEL_ROW_SELECTED_CLASS_NAME } from "./pickerPanelStyles";
import {
  composerPickerRowShortcutLabel,
  TRAITS_PICKER_POPUP_ATTRIBUTE,
  useComposerPickerRowShortcuts,
} from "./composerPickerShortcuts";
import { useComposerTraitCommit } from "./useComposerTraitCommit";

const INHERIT_VALUE = "__inherit__";

type TraitSection = {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  patchFor: (value: string) => Record<string, unknown>;
};

type SpeedToggle = {
  checked: boolean;
  patchFor: (checked: boolean) => Record<string, unknown>;
};

function isSpeedDescriptor(descriptor: ProviderOptionDescriptor): boolean {
  return descriptor.id === "serviceTier" || descriptor.id === "fastMode";
}

function resolveSpeedToggle(
  descriptor: ProviderOptionDescriptor,
  modelOptions: ProviderOptions | undefined,
): SpeedToggle | null {
  const fastValue =
    descriptor.type === "boolean"
      ? true
      : descriptor.options.find((option) => option.id === "priority" || option.id === "fast")?.id;
  if (fastValue === undefined) return null;
  return {
    checked: modelOptions?.[descriptor.id as keyof ProviderOptions] === fastValue,
    patchFor: (checked) => ({
      [descriptor.id]: checked ? fastValue : descriptor.type === "boolean" ? false : undefined,
    }),
  };
}

function resolveDescriptorSection(
  descriptor: ProviderOptionDescriptor,
  modelOptions: ProviderOptions | undefined,
): TraitSection {
  const current = modelOptions?.[descriptor.id as keyof ProviderOptions];
  const defaultOption = {
    value: INHERIT_VALUE,
    label: descriptor.id === "thinking" ? "Auto" : "Default",
  };
  if (descriptor.type === "boolean") {
    return {
      id: descriptor.id,
      label: descriptor.label,
      value: typeof current === "boolean" ? (current ? "on" : "off") : INHERIT_VALUE,
      options: [defaultOption, { value: "on", label: "On" }, { value: "off", label: "Off" }],
      patchFor: (value) => ({
        [descriptor.id]: value === INHERIT_VALUE ? undefined : value === "on",
      }),
    };
  }
  return {
    id: descriptor.id,
    label: descriptor.label,
    value: typeof current === "string" ? current : INHERIT_VALUE,
    options: [
      defaultOption,
      ...descriptor.options.map((option) => ({ value: option.id, label: option.label })),
    ],
    patchFor: (value) => ({ [descriptor.id]: value === INHERIT_VALUE ? undefined : value }),
  };
}

export function ComposerTraitsPicker(props: {
  threadId: ThreadId;
  provider: ProviderKind;
  model: string;
  modelOptions: ProviderOptions | undefined;
  runtimeModel: ProviderModelDescriptor | undefined;
  fastModeNotice: string | null;
  hideLabel: boolean;
  shortcutLabel: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { threadId, provider, model, runtimeModel } = props;
  const selection = getComposerTraitSelection(
    provider,
    model,
    "",
    props.modelOptions,
    runtimeModel,
  );
  const modelOptions = resolveComposerModelOptions(props.modelOptions, selection.descriptors);
  const commitTrait = useComposerTraitCommit({ threadId, provider, model, modelOptions });

  const effortDescriptor =
    selection.effortLevels.length > 0 ? selection.primarySelectDescriptor : null;
  const reasoning: TraitSection | null = effortDescriptor && {
    id: effortDescriptor.id,
    label: "Thinking",
    value: selection.effort ?? "",
    options: selection.effortLevels,
    patchFor: (value) => ({ [effortDescriptor.id]: value }),
  };
  const speedDescriptor = selection.descriptors.find(isSpeedDescriptor);
  const speed = speedDescriptor ? resolveSpeedToggle(speedDescriptor, modelOptions) : null;
  const otherSections = selection.descriptors
    .filter(
      (descriptor) =>
        descriptor !== selection.primarySelectDescriptor &&
        // Adaptive thinking is deliberately not offered; the model keeps its own default.
        descriptor !== selection.thinkingDescriptor &&
        !isSpeedDescriptor(descriptor),
    )
    .map((descriptor) => resolveDescriptorSection(descriptor, modelOptions));
  useComposerPickerRowShortcuts(props.open, (index) => {
    const option = reasoning?.options[index];
    if (!reasoning || !option) return;
    commitTrait(reasoning.patchFor(option.value));
    props.onOpenChange(false);
  });

  if (reasoning === null && speed === null && otherSections.length === 0) return null;

  const summary = resolveComposerTraitsSummary(selection);
  const fastModeNotice = speed?.checked ? props.fastModeNotice : null;
  const TriggerIcon =
    reasoning !== null ? Brain03Icon : speed !== null ? EnergyFilledIcon : SettingsIcon;
  const fastBadgeClassName = cn(
    "size-3.5 shrink-0",
    fastModeNotice ? "text-warning" : COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME,
  );

  const renderSection = (section: TraitSection) => (
    <MenuGroup>
      <MenuGroupLabel>{section.label}</MenuGroupLabel>
      <MenuRadioGroup
        value={section.value}
        onValueChange={(value: string) => commitTrait(section.patchFor(value))}
      >
        {section.options.map((option, index) => {
          const shortcutLabel =
            section === reasoning ? composerPickerRowShortcutLabel(index) : null;
          return (
            <MenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick
              showIndicator={false}
              className={
                option.value === section.value ? PICKER_PANEL_ROW_SELECTED_CLASS_NAME : undefined
              }
            >
              {option.label}
              {shortcutLabel ? (
                <ShortcutKbd
                  shortcutLabel={shortcutLabel}
                  className="ms-auto shrink-0 text-muted-foreground"
                />
              ) : null}
            </MenuRadioItem>
          );
        })}
      </MenuRadioGroup>
    </MenuGroup>
  );

  const triggerButton = (
    <Button
      size="sm"
      variant="chrome"
      className={cn(
        "min-w-0 shrink-0 gap-1.5 whitespace-nowrap ps-1 pe-2 [&_svg]:mx-0",
        COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
      )}
      aria-label={`Change reasoning and speed, currently ${summary.summaryText}`}
      {...(props.hideLabel ? { title: summary.summaryText } : {})}
    />
  );
  const triggerContent = (
    <span className={cn("flex items-center gap-1.5", COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME)}>
      <TriggerIcon
        aria-hidden="true"
        className={TriggerIcon === EnergyFilledIcon ? fastBadgeClassName : "size-3.5 shrink-0"}
      />
      <span className={props.hideLabel ? "sr-only" : "text-ui-xs"}>{summary.label}</span>
      {summary.showsFastBadge ? (
        <EnergyFilledIcon aria-hidden="true" className={fastBadgeClassName} />
      ) : null}
      <ChevronDownIcon aria-hidden="true" className="ms-0.5 size-3 shrink-0 opacity-60" />
    </span>
  );

  return (
    <Menu open={props.open} onOpenChange={props.onOpenChange}>
      <Tooltip>
        <TooltipTrigger render={<MenuTrigger render={triggerButton} />}>
          {triggerContent}
        </TooltipTrigger>
        {!props.open && props.shortcutLabel ? (
          <TooltipPopup side="top" sideOffset={6} variant="picker">
            <span className="inline-flex items-center gap-2 px-1 py-0.5">
              <span>Reasoning and speed</span>
              <ShortcutKbd shortcutLabel={props.shortcutLabel} />
            </span>
          </TooltipPopup>
        ) : null}
      </Tooltip>
      <ComposerPickerMenuPopup
        align="start"
        side="top"
        className="w-[min(12rem,92vw)] bg-popover/55 backdrop-blur-3xl backdrop-saturate-200"
        {...{ [TRAITS_PICKER_POPUP_ATTRIBUTE]: "" }}
      >
        {reasoning ? renderSection(reasoning) : null}
        {speed !== null ? (
          <>
            {reasoning ? <MenuSeparator /> : null}
            <MenuCheckboxItem
              variant="switch"
              checked={speed.checked}
              onCheckedChange={(checked) => commitTrait(speed.patchFor(checked))}
            >
              <span className="flex items-center gap-2">
                <EnergyFilledIcon className="size-3.5 shrink-0" />
                Fast mode
              </span>
            </MenuCheckboxItem>
            {fastModeNotice || provider === "claudeAgent" ? (
              <div
                className={cn(
                  "px-2 pb-1 text-ui-xs leading-snug",
                  fastModeNotice ? "text-warning" : "text-muted-foreground",
                )}
              >
                {fastModeNotice ?? CLAUDE_FAST_MODE_BILLING_NOTE}
              </div>
            ) : null}
          </>
        ) : null}
        {otherSections.map((section, index) => (
          <Fragment key={section.id}>
            {index > 0 || reasoning || speed ? <MenuSeparator /> : null}
            {renderSection(section)}
          </Fragment>
        ))}
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
