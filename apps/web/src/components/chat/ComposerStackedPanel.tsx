import { type HTMLAttributes, type ReactNode, type Ref } from "react";

import { cn } from "~/lib/utils";
import { ComposerStackedHeaderFrame } from "./ComposerColumnFrame";
import { COMPOSER_STACKED_PANEL_CHROME_CLASS_NAME } from "./composerStackedPanelStyles";

interface ComposerStackedPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;

  attachedToPrevious?: boolean;

  passthroughSideMargins?: boolean;

  borderless?: boolean;

  /** Standalone notice above the composer: full outline and rounded bottom corners. */
  detached?: boolean;
}

export function ComposerStackedPanel({
  children,
  className,
  ref,
  attachedToPrevious: attachedToPreviousProp,
  passthroughSideMargins: passthroughSideMarginsProp,
  borderless: borderlessProp,
  detached: detachedProp,
  ...rest
}: ComposerStackedPanelProps) {
  const attachedToPrevious = attachedToPreviousProp ?? false;
  const passthroughSideMargins = passthroughSideMarginsProp ?? false;
  const borderless = borderlessProp ?? false;
  const detached = detachedProp ?? false;
  return (
    <ComposerStackedHeaderFrame
      ref={ref}
      passthroughSideMargins={passthroughSideMargins}
      data-composer-stacked-attached={attachedToPrevious ? "true" : undefined}
      className={cn(
        COMPOSER_STACKED_PANEL_CHROME_CLASS_NAME,
        detached && "w-full rounded-b-[calc(var(--composer-radius)-1px)]! border-b",
        borderless && "border-0",
        className,
      )}
      {...rest}
    >
      {children}
    </ComposerStackedHeaderFrame>
  );
}
