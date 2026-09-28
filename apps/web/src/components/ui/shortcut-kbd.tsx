import { Kbd, KbdGroup } from "./kbd";
import { splitShortcutLabel } from "../../keybindings";
import { cn } from "~/lib/utils";

export function ShortcutKbd(props: {
  shortcutLabel: string;
  className?: string;
  groupClassName?: string;
  compact?: boolean;
}) {
  if (props.compact) {
    return (
      <Kbd className={cn("h-4 min-w-4 px-1 text-ui-2xs", props.className)}>
        {props.shortcutLabel}
      </Kbd>
    );
  }

  const parts = splitShortcutLabel(props.shortcutLabel);

  return (
    <KbdGroup className={cn("gap-1", props.groupClassName)}>
      {parts.map((part) => (
        <Kbd key={part} className={props.className}>
          {part}
        </Kbd>
      ))}
    </KbdGroup>
  );
}
