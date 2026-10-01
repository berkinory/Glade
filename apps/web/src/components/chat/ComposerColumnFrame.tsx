import {
  createContext,
  memo,
  useContext,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

import { cn } from "~/lib/utils";
import {
  CHAT_COLUMN_FRAME_CLASS_NAME,
  COMPOSER_STACKED_HEADER_FRAME_CLASS_NAME,
} from "./composerPickerStyles";

const ComposerColumnFrameContext = createContext(false);

function useComposerColumnFrameContext(componentName: string) {
  const insideComposerColumnFrame = useContext(ComposerColumnFrameContext);
  if (import.meta.env.DEV && !insideComposerColumnFrame) {
    console.warn(
      `${componentName} must render inside ComposerColumnFrame so stacked activity stays aligned to the composer input width.`,
    );
  }
  return insideComposerColumnFrame;
}

interface ComposerColumnFrameProps {
  children: ReactNode;
  className?: string;
}

export const ComposerColumnFrame = function ComposerColumnFrame({
  children,
  className,
}: ComposerColumnFrameProps) {
  return (
    <ComposerColumnFrameContext.Provider value={true}>
      <div className={cn(CHAT_COLUMN_FRAME_CLASS_NAME, className)}>{children}</div>
    </ComposerColumnFrameContext.Provider>
  );
};

interface ComposerStackedHeaderFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  ref?: Ref<HTMLDivElement> | undefined;

  passthroughSideMargins?: boolean;
}

export const ComposerStackedHeaderFrame = memo(function ComposerStackedHeaderFrame({
  children,
  className,
  ref,
  passthroughSideMargins: passthroughSideMarginsProp,
  ...rest
}: ComposerStackedHeaderFrameProps) {
  const passthroughSideMargins = passthroughSideMarginsProp ?? false;
  useComposerColumnFrameContext("ComposerStackedHeaderFrame");

  const frameClassName = cn(COMPOSER_STACKED_HEADER_FRAME_CLASS_NAME, className);

  if (passthroughSideMargins) {
    return (
      <div className="pointer-events-none w-full">
        <div ref={ref} className={cn("pointer-events-auto", frameClassName)} {...rest}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={frameClassName} {...rest}>
      {children}
    </div>
  );
});
