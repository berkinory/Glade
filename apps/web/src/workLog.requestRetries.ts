import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { ProviderFailureKind } from "@glade/contracts/provider/providerFailure";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { Schema } from "effect";

import { firstFiniteNumber } from "./workLog.extraction";
import type { WorkLogRequestRetry } from "./workLog.types";

const isProviderFailureKind = Schema.is(ProviderFailureKind);

/** A provider request the provider is about to retry, as the server normalises it for every provider. */
export function requestRetryFromActivity(
  activity: OrchestrationThreadActivity,
): WorkLogRequestRetry | undefined {
  if (activity.kind !== "runtime.warning") return undefined;
  const retry = asObjectRecord(asObjectRecord(activity.payload)?.requestRetry);
  if (!retry || !isProviderFailureKind(retry.reason)) return undefined;
  const attempt = firstFiniteNumber(retry.attempt);
  const maxAttempts = firstFiniteNumber(retry.maxAttempts);
  const delayMs = firstFiniteNumber(retry.delayMs);
  return {
    reason: retry.reason,
    httpStatus: firstFiniteNumber(retry.httpStatus) ?? null,
    ...(attempt !== undefined ? { attempt } : {}),
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    ...(delayMs !== undefined ? { delayMs } : {}),
  };
}
