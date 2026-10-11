import type { EditorOption } from "~/editorMetadata";
import { MenuRadioItem, MenuShortcut } from "../ui/menu";

export function EditorMenuRadioItem(props: {
  option: EditorOption;
  shortcutLabel: string | null;
  disabled?: boolean;
  onOpen: () => void;
}) {
  const { Icon, label, value } = props.option;
  return (
    <MenuRadioItem
      preserveChildLayout
      trailing={props.shortcutLabel ? <MenuShortcut>{props.shortcutLabel}</MenuShortcut> : null}
      value={value}
      disabled={props.disabled ?? false}
      onClick={props.onOpen}
    >
      <span className="flex min-w-0 items-center gap-2">
        {/* The system UI font's ink sits below its line box center, so a box-centered icon reads high. */}
        <Icon
          aria-hidden="true"
          className="size-3.5 shrink-0 translate-y-[0.5px] text-muted-foreground"
        />
        <span className="truncate">{label}</span>
      </span>
    </MenuRadioItem>
  );
}
