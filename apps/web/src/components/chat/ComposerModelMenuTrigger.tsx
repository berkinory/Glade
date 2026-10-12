import { ChevronDownIcon } from "~/lib/icons";
import { Spinner } from "~/components/ui/spinner";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { cn } from "~/lib/utils";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../ProviderIcon";
import { Button } from "../ui/button";
import { MenuTrigger } from "../ui/menu";
import { ShortcutKbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME } from "./composerPickerStyles";
import { getProviderIconClassName } from "./ProviderModelPicker";
export function ComposerModelMenuTrigger(props: {
  provider: ProviderKind;
  modelLabel: string;
  hideModelLabel?: boolean | undefined;
  disabled?: boolean | undefined;
  isMenuOpen: boolean;
  loading?: boolean;
  shortcutLabel?: string | null | undefined;
}) {
  const ProviderIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[props.provider];
  const triggerButton = (
    <Button
      size="sm"
      variant="chrome"
      disabled={props.loading || (props.disabled ?? false)}
      className={cn(
        "min-w-0 shrink-0 justify-start gap-1.5 whitespace-nowrap ps-2 pe-1 sm:ps-2.5 [&_svg]:mx-0",
        COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
      )}
      aria-label={props.loading ? "Loading models" : `Change model, currently ${props.modelLabel}`}
      {...(props.hideModelLabel ? { title: props.modelLabel } : {})}
    />
  );
  const triggerContent = (
    <span className="flex min-w-0 items-center gap-1.5">
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
        <span className="sr-only">{props.modelLabel}</span>
      ) : (
        <span className="relative min-w-0 truncate text-[var(--color-text-foreground)]">
          <span className={props.loading ? "invisible" : undefined}>{props.modelLabel}</span>
          {props.loading ? <span className="absolute inset-0 truncate">Loading models</span> : null}
        </span>
      )}
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
