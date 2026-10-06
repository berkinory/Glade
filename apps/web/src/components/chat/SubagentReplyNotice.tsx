import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useNavigate } from "@tanstack/react-router";
import type { WorkLogEntry } from "~/workLog.types";
import { useStore } from "~/store";
import { resolveSubagentPresentation } from "~/lib/subagentPresentation";
import { BotIcon } from "~/lib/icons";
import { SubagentAvatar } from "./SubagentAvatar";

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
      {source ? (
        <SubagentAvatar threadId={source.threadId} className="size-[1.143em]" />
      ) : (
        <BotIcon className="size-[1.143em] shrink-0" />
      )}
      <span className="truncate">{name ? `Reply from ${name}` : "Subagent reply"}</span>
    </>
  );
  const className = "flex min-w-0 items-center gap-2 py-1 text-chat text-muted-foreground";
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
