import { useNavigate } from "@tanstack/react-router";
import { ComputerTerminal01Icon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";
import { type BackgroundWaitItem, describeBackgroundWait } from "./BackgroundWaitRow.logic";
import { SubagentAvatar } from "./SubagentAvatar";
import {
  WORK_ROW_GAP_CLASS_NAME,
  WORK_ROW_ICON_CLASS_NAME,
  WORK_ROW_ICON_SLOT_CLASS_NAME,
} from "./workRowStyles";

const MAX_AVATARS = 3;

// Sits where the reply marker will appear, in the same shape, so the wake reads as one row
// turning from "Waiting for" into "Reply from".
export function BackgroundWaitRow({ items }: { items: readonly BackgroundWaitItem[] }) {
  const navigate = useNavigate();
  const subagentThreadIds = items.flatMap((item) =>
    item.kind === "subagent" ? [item.threadId] : [],
  );
  const [only] = items;
  const target = useStore((state) =>
    items.length === 1 && only?.kind === "subagent"
      ? state.threadShellById?.[only.threadId]
      : undefined,
  );
  const content = (
    <>
      {subagentThreadIds.length > 0 ? (
        <span className="flex shrink-0 items-center gap-0.5">
          {subagentThreadIds.slice(0, MAX_AVATARS).map((threadId) => (
            <span key={threadId} className={WORK_ROW_ICON_SLOT_CLASS_NAME}>
              <SubagentAvatar threadId={threadId} className="size-4" />
            </span>
          ))}
        </span>
      ) : (
        <span className={WORK_ROW_ICON_SLOT_CLASS_NAME}>
          <ComputerTerminal01Icon className={WORK_ROW_ICON_CLASS_NAME} />
        </span>
      )}
      <span className="min-w-0 truncate">
        <span className="work-text-shimmer">{describeBackgroundWait(items)}</span>
      </span>
    </>
  );
  const className = cn(
    "flex min-w-0 items-center py-1 text-chat text-muted-foreground",
    WORK_ROW_GAP_CLASS_NAME,
  );
  if (!target || target.archivedAt) {
    return (
      <div role="status" className={className}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cn(
        className,
        "rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      onClick={() => {
        void navigate({ to: "/$threadId", params: { threadId: target.id } });
      }}
    >
      {content}
    </button>
  );
}
