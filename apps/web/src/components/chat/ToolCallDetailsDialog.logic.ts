import type { WorkLogToolDetails } from "../../lib/toolCallDetails";
import type { WorkLogLiveActivity, WorkLogToolKind } from "../../workLog.types";
import { describeToolInput } from "./ToolIoDetails.logic";

export function hasToolCallDetailsContent(
  details: WorkLogToolDetails | undefined,
  activity: WorkLogLiveActivity | undefined,
  toolKind: WorkLogToolKind | undefined,
): boolean {
  if (!details) return Boolean(activity?.detail?.trim());
  const output = details.output;
  // A plain tool shows the image it viewed, or else the arguments its row does not already name
  // and its text output.
  if (details.kind === "tool") {
    return Boolean(
      details.imageSnapshotUrl !== undefined ||
      (details.input && describeToolInput(details.input, toolKind) !== null) ||
      output?.output?.trim(),
    );
  }
  return Boolean(
    details.command?.trim() ||
    (details.input !== undefined && Object.keys(details.input).length > 0) ||
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
