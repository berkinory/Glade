import { SquareSplitHorizontal, SquareSplitVertical } from "~/lib/icons";
import { Button } from "../ui/button";

export function DiffLayoutToggle(props: {
  value: "unified" | "split";
  onChange: (value: "unified" | "split") => void;
}) {
  return (
    <>
      <Button
        size="icon-xs"
        variant="chrome"
        aria-label="Unified diff"
        title="Unified diff"
        aria-pressed={props.value === "unified"}
        onClick={() => props.onChange("unified")}
      >
        <SquareSplitVertical className="size-3.5" />
      </Button>
      <Button
        size="icon-xs"
        variant="chrome"
        aria-label="Side by side diff"
        title="Side by side diff"
        aria-pressed={props.value === "split"}
        onClick={() => props.onChange("split")}
      >
        <SquareSplitHorizontal className="size-3.5" />
      </Button>
    </>
  );
}
