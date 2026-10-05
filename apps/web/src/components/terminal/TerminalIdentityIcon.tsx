import { ComputerTerminal01Icon } from "~/lib/icons";
import { ClaudeIcon, OpenAIIcon } from "~/lib/brandIcons";
import type { TerminalIconKey } from "@glade/shared/threads/terminalThreads";
import { cn } from "~/lib/utils";
interface TerminalIdentityIconProps {
  iconKey: TerminalIconKey;
  className?: string;
}
export default function TerminalIdentityIcon({ iconKey, className }: TerminalIdentityIconProps) {
  const IconComponent =
    iconKey === "openai" ? OpenAIIcon : iconKey === "claude" ? ClaudeIcon : ComputerTerminal01Icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", className)}>
      <IconComponent className={cn("size-full text-[var(--color-text-foreground)]")} />
    </span>
  );
}
