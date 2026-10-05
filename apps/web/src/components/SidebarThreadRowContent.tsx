import { ComputerTerminal01Icon } from "~/lib/icons";
import { type ReactNode } from "react";
import { pluralize } from "@glade/shared/text/text";
import { resolveSubagentPresentation } from "../lib/subagentPresentation";
import { SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME } from "../sidebarRowStyles";
import type { SidebarThreadSummary } from "../types";
import { cn } from "../lib/utils";
import { SubagentAvatar } from "./chat/SubagentAvatar";
import { ProviderIcon } from "./ProviderIcon";
import { SidebarLeadingIcon } from "./SidebarLeadingIcon";
import { sidebarGlyphClass } from "./sidebarGlyphs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
export interface SidebarThreadTerminalStatus {
  label: "Terminal input needed" | "Terminal task completed" | "Terminal process running";
  colorClass: string;
  pulse: boolean;
}
function ProviderAvatarWithTerminal({
  thread,
  terminalStatus,
  terminalCount,
  projectBadge,
}: {
  thread: SidebarThreadSummary;
  terminalStatus: SidebarThreadTerminalStatus | null;
  terminalCount: number;
  projectBadge?: ReactNode;
}) {
  const provider = thread.session?.provider ?? thread.modelSelection.provider;
  const showBadge = terminalCount > 1 || terminalStatus !== null;
  const badgeTooltip =
    terminalCount > 1
      ? `${terminalCount} ${pluralize(terminalCount, "terminal")} open`
      : (terminalStatus?.label ?? "Terminal open");
  const badgeColorClass = terminalStatus?.colorClass ?? "text-muted-foreground/55";
  const avatarNode = <ProviderIcon provider={provider} className={sidebarGlyphClass("leading")} />;
  return (
    <SidebarLeadingIcon size="sm" tone="text-inherit">
      {avatarNode}
      {projectBadge ? (
        <span className="sidebar-icon-chip absolute -bottom-1 -right-1 inline-flex size-2.5 items-center justify-center rounded-sm">
          {projectBadge}
        </span>
      ) : null}
      {showBadge ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                aria-label={badgeTooltip}
                className="sidebar-icon-chip absolute -top-1.5 -right-1.5 inline-flex size-3 min-w-3 items-center justify-center rounded-full px-px"
              >
                {terminalCount > 1 ? (
                  <span
                    className={cn(
                      "text-[8px] font-semibold leading-none tabular-nums",
                      badgeColorClass,
                    )}
                  >
                    {terminalCount}
                  </span>
                ) : (
                  <ComputerTerminal01Icon className={cn("size-2.5", badgeColorClass)} />
                )}
              </span>
            }
          />
          <TooltipPopup side="top">{badgeTooltip}</TooltipPopup>
        </Tooltip>
      ) : null}
    </SidebarLeadingIcon>
  );
}
export function SidebarThreadRowContent({
  thread,
  terminalStatus,
  terminalCount,
  isActive,
  variant,
  subagentIndentPx: subagentIndentPxProp,
  pendingStatusColorClass,
  projectBadge,
}: {
  thread: SidebarThreadSummary;
  terminalStatus: SidebarThreadTerminalStatus | null;
  terminalCount: number;
  isActive: boolean;
  variant: "pinned" | "standard";
  subagentIndentPx?: number;
  pendingStatusColorClass?: string | null | undefined;
  projectBadge?: ReactNode;
}) {
  const subagentIndentPx = subagentIndentPxProp ?? 0;
  const isSubagentThread = Boolean(thread.parentThreadId);
  const subagentPresentation = isSubagentThread
    ? resolveSubagentPresentation({
        nickname: thread.subagentNickname,
        role: thread.subagentRole,
        title: thread.title,
        fallbackId: thread.id,
      })
    : null;
  return (
    <>
      {isSubagentThread ? (
        <span
          className="inline-flex shrink-0 items-center"
          style={{ marginLeft: `${subagentIndentPx}px` }}
        >
          <SubagentAvatar threadId={thread.id} />
        </span>
      ) : (
        <ProviderAvatarWithTerminal
          thread={thread}
          terminalStatus={terminalStatus}
          terminalCount={terminalCount}
          projectBadge={projectBadge}
        />
      )}
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center text-left",
          variant === "standard" && isSubagentThread ? "gap-[5px]" : "gap-1.5",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-ui",
            !isSubagentThread && "group-hover/thread-row:pr-10 group-focus-within/thread-row:pr-10",
            isActive ? "text-foreground" : SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
            "leading-5",
          )}
          data-testid={variant === "pinned" ? `thread-title-${thread.id}` : undefined}
        >
          {subagentPresentation?.primaryLabel ?? thread.title}
        </span>
        {!isSubagentThread && pendingStatusColorClass ? (
          <span
            aria-label="Pending approval"
            className={cn("shrink-0 text-ui-xs font-medium", pendingStatusColorClass)}
          >
            Pending
          </span>
        ) : null}
      </div>
    </>
  );
}
