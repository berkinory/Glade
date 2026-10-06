// Provider diff placeholders and live captures taken while a turn runs carry diff totals only. They
// must never settle the turn they describe; only the terminal checkpoint does.
export function isInProgressTurnDiff(diff: {
  readonly status?: string | undefined;
  readonly checkpointRef?: string | undefined;
}): boolean {
  const ref = diff.checkpointRef ?? "";
  return (
    diff.status === "missing" && (ref.startsWith("provider-diff:") || ref.includes("/turn-live/"))
  );
}
