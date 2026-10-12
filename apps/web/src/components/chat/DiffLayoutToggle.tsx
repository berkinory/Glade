import { useAppSettings } from "~/appSettings";
import { SquareSplitHorizontalIcon, SquareSplitVerticalIcon } from "~/lib/icons";
import { IconButton } from "../ui/icon-button";
export function DiffLayoutToggle() {
  const { settings, updateSettings } = useAppSettings();
  const nextValue = settings.diffLayout === "unified" ? "split" : "unified";
  const label = nextValue === "split" ? "Switch to side by side diff" : "Switch to unified diff";
  return (
    <IconButton
      size="icon-xs"
      variant="chrome"
      label={label}
      tooltip={label}
      onClick={() => updateSettings({ diffLayout: nextValue })}
    >
      {nextValue === "split" ? (
        <SquareSplitHorizontalIcon className="size-3.5" />
      ) : (
        <SquareSplitVerticalIcon className="size-3.5" />
      )}
    </IconButton>
  );
}
