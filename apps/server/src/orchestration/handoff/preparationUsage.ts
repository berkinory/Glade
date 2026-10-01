import type { OrchestrationThread } from "@glade/contracts/orchestration/threadEntities";

export function preparationUsage(activities: OrchestrationThread["activities"], identity: string) {
  const previousRequests = activities.filter(
    (activity) =>
      activity.kind === "handoff.preparation.request" &&
      typeof activity.payload === "object" &&
      activity.payload !== null &&
      "inputIdentity" in activity.payload &&
      activity.payload.inputIdentity === identity,
  );
  const previousPasses = activities.filter(
    (activity) =>
      activity.kind === "handoff.preparation.pass" &&
      typeof activity.payload === "object" &&
      activity.payload !== null &&
      "inputIdentity" in activity.payload &&
      activity.payload.inputIdentity === identity,
  );
  const passes = previousRequests.length;
  const estimatedInputTokens = previousRequests.reduce(
    (sum, activity) =>
      sum +
      (typeof activity.payload === "object" &&
      activity.payload !== null &&
      "estimatedInputTokens" in activity.payload &&
      typeof activity.payload.estimatedInputTokens === "number"
        ? activity.payload.estimatedInputTokens
        : 0),
    0,
  );
  const estimatedOutputTokens = previousPasses.reduce(
    (sum, activity) =>
      sum +
      (typeof activity.payload === "object" &&
      activity.payload !== null &&
      "estimatedOutputTokens" in activity.payload &&
      typeof activity.payload.estimatedOutputTokens === "number"
        ? activity.payload.estimatedOutputTokens
        : 0),
    0,
  );
  let nativeInputTokens: number | null =
    previousRequests.length === previousPasses.length ? 0 : null;
  let nativeOutputTokens: number | null = nativeInputTokens;
  for (const pass of previousPasses) {
    const payload = pass.payload;
    if (typeof payload !== "object" || payload === null) continue;
    nativeInputTokens =
      nativeInputTokens !== null &&
      "inputTokens" in payload &&
      typeof payload.inputTokens === "number"
        ? nativeInputTokens + payload.inputTokens
        : null;
    nativeOutputTokens =
      nativeOutputTokens !== null &&
      "outputTokens" in payload &&
      typeof payload.outputTokens === "number"
        ? nativeOutputTokens + payload.outputTokens
        : null;
  }
  return {
    passes,
    estimatedInputTokens,
    estimatedOutputTokens,
    nativeInputTokens,
    nativeOutputTokens,
  };
}
