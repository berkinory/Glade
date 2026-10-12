import { cn } from "~/lib/utils";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useNavigate } from "@tanstack/react-router";
import type { WorkLogEntry } from "~/workLog.types";
import { useStore } from "~/store";
import { resolveSubagentPresentation } from "~/lib/subagentPresentation";
import { ComputerTerminal01Icon } from "~/lib/icons";
import { SubagentAvatar } from "./SubagentAvatar";
import {
  WORK_ROW_GAP_CLASS_NAME,
  WORK_ROW_ICON_CLASS_NAME,
  WORK_ROW_ICON_SLOT_CLASS_NAME,
} from "./workRowStyles";

export function SubagentReplyNotice({ entry }: { entry: WorkLogEntry }) {
  const navigate = useNavigate();
  const source = entry.replySource;
  const thread = useStore((state) =>
    source ? state.threadShellById?.[ThreadId.makeUnsafe(source.threadId)] : undefined,
  );
  const name = source
    ? resolveSubagentPresentation({
        nickname: source.nickname,
        fallbackId: source.threadId,
      }).primaryLabel
    : null;
  const content = (
    <>
      <span className={WORK_ROW_ICON_SLOT_CLASS_NAME}>
        {source ? (
          <SubagentAvatar threadId={source.threadId} className="size-4" />
        ) : (
          <ComputerTerminal01Icon className={WORK_ROW_ICON_CLASS_NAME} />
        )}
      </span>
      <span className="truncate">{name ? `Reply from ${name}` : "Background task finished"}</span>
    </>
  );
  const className = cn(
    "flex min-w-0 items-center py-1 text-chat text-muted-foreground",
    WORK_ROW_GAP_CLASS_NAME,
  );
  if (!thread || thread.archivedAt) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      className={`${className} rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      onClick={() => {
        void navigate({ to: "/$threadId", params: { threadId: thread.id } });
      }}
    >
      {content}
    </button>
  );
}
