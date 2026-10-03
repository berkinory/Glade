import { SquareSplitHorizontal, SquareSplitVertical } from "~/lib/icons";
import { IconButton } from "../ui/icon-button";

export function DiffLayoutToggle(props: {
  value: "unified" | "split";
  onChange: (value: "unified" | "split") => void;
}) {
  const nextValue = props.value === "unified" ? "split" : "unified";
  const label = nextValue === "split" ? "Switch to side by side diff" : "Switch to unified diff";
  return (
    <IconButton
      size="icon-xs"
      variant="chrome"
      label={label}
      tooltip={label}
      onClick={() => props.onChange(nextValue)}
    >
      {nextValue === "split" ? (
        <SquareSplitHorizontal className="size-3.5" />
      ) : (
        <SquareSplitVertical className="size-3.5" />
      )}
    </IconButton>
  );
}
