import { cn } from "~/lib/utils";
import { ELEVATED_HOVER_SURFACE_CLASS_NAME } from "~/surfaceStyles";
import { TRANSCRIPT_SELECTION_ACTION_WIDTH_PX } from "./chatSelectionActions";

interface TranscriptSelectionActionProps {
  left: number;
  top: number;
  placement: "top" | "bottom";
  onAddToChat: () => void;
  onAddToNewChat?: (() => void) | undefined;
  disabled?: boolean | undefined;
}

function TranscriptSelectionToolbarButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "pointer-events-auto inline-flex h-7 flex-none items-center justify-center whitespace-nowrap px-2.5 text-ui leading-snug text-[var(--color-text-foreground)] outline-none focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-40",
        ELEVATED_HOVER_SURFACE_CLASS_NAME,
      )}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <span>{label}</span>
    </button>
  );
}

export function TranscriptSelectionAction(props: TranscriptSelectionActionProps) {
  return (
    <div
      data-transcript-selection-action="true"
      className="pointer-events-none fixed z-50 flex justify-center"
      style={{ left: props.left, top: props.top, width: TRANSCRIPT_SELECTION_ACTION_WIDTH_PX }}
      role="toolbar"
      aria-label="Selection actions"
    >
      {}
      <div className="pointer-events-auto inline-flex w-max max-w-[calc(100vw-16px)] shrink-0 items-center divide-x divide-[var(--color-border)] overflow-hidden rounded-lg border border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)] shadow-md">
        <TranscriptSelectionToolbarButton
          label="Add to Chat"
          onClick={props.onAddToChat}
          disabled={props.disabled}
        />
        {props.onAddToNewChat ? (
          <TranscriptSelectionToolbarButton
            label="Add to new Chat"
            onClick={props.onAddToNewChat}
            disabled={props.disabled}
          />
        ) : null}
      </div>
    </div>
  );
}
