import { ChevronDownIcon, EnergyFilledIcon, SettingsIcon } from "~/lib/icons";
import { Spinner } from "~/components/ui/spinner";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../ProviderIcon";
import { Button } from "../ui/button";
import { MenuTrigger } from "../ui/menu";
import { ShortcutKbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME,
  COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
} from "./composerPickerStyles";
import { getProviderIconClassName } from "./ProviderModelPicker";
export function ComposerModelMenuTrigger(props: {
  provider: ProviderKind;
  modelLabel: string;
  statusLabel: string | null;
  showsFastBadge: boolean;
  hideModelLabel?: boolean | undefined;
  hideStatusLabel?: boolean | undefined;
  disabled?: boolean | undefined;
  isMenuOpen: boolean;
  loading?: boolean;
  openPlaceholderLabel?: string | null | undefined;
  shortcutLabel?: string | null | undefined;
}) {
  const freezesLabel = props.isMenuOpen && Boolean(props.openPlaceholderLabel);
  const showsPlaceholder = freezesLabel && !props.hideModelLabel;
  // Opening must not move the trigger at all: Base UI opens on mousedown and cancels the open when
  // the matching mouseup lands outside the trigger, so a resize under the cursor eats the first
  // click.
  const liveLabel = {
    modelLabel: props.modelLabel,
    statusLabel: props.statusLabel,
    showsFastBadge: props.showsFastBadge,
  };
  const [frozenLabel, setFrozenLabel] = useState<typeof liveLabel | null>(null);
  if (freezesLabel && frozenLabel === null) setFrozenLabel(liveLabel);
  if (!freezesLabel && frozenLabel !== null) setFrozenLabel(null);
  const label = freezesLabel && frozenLabel !== null ? frozenLabel : liveLabel;
  const [hasShownPlaceholder, setHasShownPlaceholder] = useState(false);
  if (showsPlaceholder && !hasShownPlaceholder) setHasShownPlaceholder(true);
  const ProviderIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[props.provider];
  const hiddenTriggerTitle = [
    props.hideModelLabel ? props.modelLabel : null,
    props.hideStatusLabel ? props.statusLabel : null,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" · ");
  const triggerButton = (
    <Button
      size="sm"
      variant="chrome"
      disabled={props.loading || (props.disabled ?? false)}
      className={cn(
        "min-w-0 shrink-0 justify-start gap-1.5 whitespace-nowrap px-2 sm:px-2.5 [&_svg]:mx-0",
        COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
      )}
      aria-label={
        props.loading
          ? "Loading models"
          : props.statusLabel
            ? `Change model and reasoning, currently ${props.statusLabel}`
            : "Change model and reasoning"
      }
      {...(hiddenTriggerTitle.length > 0
        ? {
            title: hiddenTriggerTitle,
          }
        : {})}
    />
  );
  const triggerContent = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="relative flex min-w-0 items-center">
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5 overflow-hidden",
            showsPlaceholder ? "invisible" : hasShownPlaceholder && "composer-trigger-label-enter",
          )}
        >
          {props.loading ? (
            <Spinner variant="action" aria-hidden="true" className="size-3.5 shrink-0" />
          ) : (
            <ProviderIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 opacity-100",
                getProviderIconClassName(props.provider, "text-[var(--color-text-foreground)]"),
              )}
            />
          )}
          {props.hideModelLabel ? (
            <span className="sr-only">{label.modelLabel}</span>
          ) : (
            <span className="relative min-w-0 truncate text-[var(--color-text-foreground)]">
              <span className={props.loading ? "invisible" : undefined}>{label.modelLabel}</span>
              {props.loading ? (
                <span className="absolute inset-0 truncate">Loading models</span>
              ) : null}
            </span>
          )}
          {label.showsFastBadge ? (
            <EnergyFilledIcon
              aria-hidden="true"
              className={cn("size-3.5 shrink-0", COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME)}
            />
          ) : null}
          {label.statusLabel ? (
            props.hideStatusLabel ? (
              <>
                <SettingsIcon
                  aria-hidden="true"
                  className={cn("size-3.5 shrink-0", COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME)}
                />
                <span className="sr-only">{label.statusLabel}</span>
              </>
            ) : (
              <span className={cn("shrink-0 text-ui-xs", COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME)}>
                {label.statusLabel}
              </span>
            )
          ) : null}
        </span>
        {showsPlaceholder ? (
          <span
            className={cn(
              "composer-trigger-label-enter absolute inset-0 truncate text-center",
              COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME,
            )}
          >
            {props.openPlaceholderLabel}
          </span>
        ) : null}
      </span>
      <ChevronDownIcon aria-hidden="true" className="ms-0.5 size-3 shrink-0 opacity-60" />
    </span>
  );
  if (props.loading) return <Button {...triggerButton.props}>{triggerContent}</Button>;
  if (!props.shortcutLabel) {
    return <MenuTrigger render={triggerButton}>{triggerContent}</MenuTrigger>;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<MenuTrigger render={triggerButton} />}>
        {triggerContent}
      </TooltipTrigger>
      {!props.isMenuOpen ? (
        <TooltipPopup side="top" sideOffset={6} variant="picker">
          <span className="inline-flex items-center gap-2 px-1 py-0.5">
            <span>Model selector</span>
            <ShortcutKbd shortcutLabel={props.shortcutLabel} />
          </span>
        </TooltipPopup>
      ) : null}
    </Tooltip>
  );
}
