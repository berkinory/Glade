import { type HTMLAttributes, type ReactNode, type Ref } from "react";

import { cn } from "~/lib/utils";
import { ComposerStackedHeaderFrame } from "./ComposerColumnFrame";
import { COMPOSER_STACKED_PANEL_CHROME_CLASS_NAME } from "./composerStackedPanelStyles";

export { COMPOSER_STACKED_PANEL_DIVIDER_CLASS_NAME } from "./composerStackedPanelStyles";

interface ComposerStackedPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;

  attachedToPrevious?: boolean;

  passthroughSideMargins?: boolean;

  borderless?: boolean;
}

export function ComposerStackedPanel({
  children,
  className,
  ref,
  attachedToPrevious: attachedToPreviousProp,
  passthroughSideMargins: passthroughSideMarginsProp,
  borderless: borderlessProp,
  ...rest
}: ComposerStackedPanelProps) {
  const attachedToPrevious = attachedToPreviousProp ?? false;
  const passthroughSideMargins = passthroughSideMarginsProp ?? false;
  const borderless = borderlessProp ?? false;
  return (
    <ComposerStackedHeaderFrame
      ref={ref}
      passthroughSideMargins={passthroughSideMargins}
      data-composer-stacked-attached={attachedToPrevious ? "true" : undefined}
      className={cn(COMPOSER_STACKED_PANEL_CHROME_CLASS_NAME, borderless && "border-0", className)}
      {...rest}
    >
      {children}
    </ComposerStackedHeaderFrame>
  );
}
