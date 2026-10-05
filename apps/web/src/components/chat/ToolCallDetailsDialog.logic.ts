import type { WorkLogToolDetails } from "../../lib/toolCallDetails";
import type { WorkLogLiveActivity } from "../../workLog.types";

export function hasToolCallDetailsContent(
  details: WorkLogToolDetails | undefined,
  activity?: WorkLogLiveActivity,
): boolean {
  if (!details) return Boolean(activity?.detail?.trim());
  const output = details.output;
  return Boolean(
    details.command?.trim() ||
    details.diff?.trim() ||
    details.content?.trim() ||
    details.files?.some((file) => file.trim()) ||
    details.edits?.some((edit) => edit.oldText !== undefined || edit.newText !== undefined) ||
    output?.output?.trim() ||
    output?.stdout?.trim() ||
    output?.stderr?.trim() ||
    output?.exitCode !== undefined ||
    output?.truncated,
  );
}
