import type { TerminalIconKey } from "@glade/shared/terminalThreads";

import { TerminalSquare } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { ClaudeAI, OpenAI } from "../Icons";

interface TerminalIdentityIconProps {
  iconKey: TerminalIconKey;
  className?: string;
}

export default function TerminalIdentityIcon({ iconKey, className }: TerminalIdentityIconProps) {
  const IconComponent =
    iconKey === "openai" ? OpenAI : iconKey === "claude" ? ClaudeAI : TerminalSquare;

  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", className)}>
      <IconComponent className={cn("size-full text-[var(--color-text-foreground)]")} />
    </span>
  );
}
