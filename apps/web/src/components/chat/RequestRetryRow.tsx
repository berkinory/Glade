import { formatClockDuration } from "../../session-logic";
import type { WorkLogRequestRetry } from "../../workLog.types";
import { RefreshCwIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ToolDetailsDisclosure } from "./TimelineWorkEntryDetails";
import {
  WORK_ROW_BLOCK_CLASS_NAME,
  WORK_ROW_ICON_CLASS_NAME,
  WORK_ROW_ICON_SLOT_CLASS_NAME,
  WORK_ROW_LINE_CLASS_NAME,
  WORK_ROW_MUTED_HOVER_TONE,
} from "./workRowStyles";

function retryReason(retry: WorkLogRequestRetry): string {
  switch (retry.reason) {
    case "connection_lost":
      return "Connection lost";
    case "rate_limited":
      return "Rate limited";
    case "overloaded":
      return "Provider overloaded";
    default:
      return retry.httpStatus === null
        ? "Request failed"
        : `Request failed (HTTP ${retry.httpStatus})`;
  }
}

function retryNumber(retry: WorkLogRequestRetry, index: number): string {
  const attempt = retry.attempt ?? index + 1;
  return retry.maxAttempts === undefined ? `${attempt}` : `${attempt}/${retry.maxAttempts}`;
}

// Consecutive retries of one provider request, folded into one row that opens to each attempt.
export function RequestRetryRow(props: {
  retries: ReadonlyArray<WorkLogRequestRetry>;
  fontSizePx: number;
}) {
  const { retries, fontSizePx } = props;
  const latest = retries.at(-1)!;
  return (
    <div className={WORK_ROW_BLOCK_CLASS_NAME} data-request-retry-row="true">
      <ToolDetailsDisclosure
        detailContent={
          <ol className="space-y-0.5 text-ui-sm text-muted-foreground">
            {retries.map((retry, index) => (
              <li key={index} className="tabular-nums">
                Retry {retryNumber(retry, index)} · {retryReason(retry)}
                {retry.delayMs !== undefined
                  ? ` · waited ${formatClockDuration(Math.max(1_000, retry.delayMs))}`
                  : ""}
              </li>
            ))}
          </ol>
        }
      >
        <span className={cn(WORK_ROW_ICON_SLOT_CLASS_NAME, WORK_ROW_MUTED_HOVER_TONE["tool-row"])}>
          <RefreshCwIcon className={WORK_ROW_ICON_CLASS_NAME} />
        </span>
        <p
          className={cn(
            "truncate",
            WORK_ROW_LINE_CLASS_NAME,
            WORK_ROW_MUTED_HOVER_TONE["tool-row"],
          )}
          style={{ fontSize: `${fontSizePx}px` }}
        >
          {retryReason(latest)} · retry {retryNumber(latest, retries.length - 1)}
        </p>
      </ToolDetailsDisclosure>
    </div>
  );
}
