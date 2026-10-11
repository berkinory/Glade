import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { asString } from "@glade/shared/text/text";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { toActivityPayload, type ActivityPayload } from "./activityPayloads";

export function buildFastModeActivityPayload(
  event: ProviderRuntimeEvent,
): ActivityPayload | undefined {
  if (event.type !== "session.configured") return undefined;
  const config = asRecord(event.payload.config);
  const state = asString(config?.fastModeState);
  if (state === undefined) return undefined;
  const disabledReason = asString(config?.fastModeDisabledReason);
  return toActivityPayload({ state, ...(disabledReason ? { disabledReason } : {}) });
}
