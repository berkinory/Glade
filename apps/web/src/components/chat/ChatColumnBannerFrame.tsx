import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import {
  CHAT_COLUMN_FRAME_CLASS_NAME,
  CHAT_COLUMN_GUTTER_CLASS_NAME,
} from "./composerPickerStyles";

export function ChatColumnBannerFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("pt-3", CHAT_COLUMN_GUTTER_CLASS_NAME, className)}>
      <div className={CHAT_COLUMN_FRAME_CLASS_NAME}>{children}</div>
    </div>
  );
}
