import { Columns2Icon, Rows3Icon } from "~/lib/icons";
import type { DiffRenderMode } from "./chat/chatHeaderControls";
import { IconButton } from "./ui/icon-button";

export function DiffPanelViewToggle(props: {
  mode: DiffRenderMode;
  onChange: (mode: DiffRenderMode) => void;
}) {
  const nextMode = props.mode === "stacked" ? "split" : "stacked";
  const label = nextMode === "split" ? "Switch to split view" : "Switch to stacked view";
  return (
    <IconButton
      size="icon-xs"
      className="shrink-0 text-muted-foreground hover:text-foreground"
      label={label}
      tooltip={label}
      onClick={() => props.onChange(nextMode)}
    >
      {nextMode === "split" ? (
        <Columns2Icon className="size-3.5" />
      ) : (
        <Rows3Icon className="size-3.5" />
      )}
    </IconButton>
  );
}
