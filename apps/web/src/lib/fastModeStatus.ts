import { type OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";

export const CLAUDE_FAST_MODE_BILLING_NOTE =
  "Fast mode is billed at a premium rate from usage credits, not plan limits.";

// Reasons Claude Code reports while fast mode is blocked. `sdk_opt_in_required` and `pending` are
// left out: they describe a session that has not opted in or checked yet, which the next report
// corrects, so showing them would flash a false warning right after the toggle.
const UNAVAILABLE_REASON_TEXT: Readonly<Record<string, string>> = {
  free: "Fast mode needs a paid Claude plan.",
  preference: "Your organization has turned fast mode off.",
  extra_usage_disabled: "Fast mode needs usage credits. Turn them on in your Claude account.",
  network_error: "Claude Code could not confirm fast mode access.",
  unknown: "Fast mode is unavailable right now.",
  not_first_party: "Fast mode only works with the Anthropic API directly.",
  disabled_by_env: "Fast mode is turned off in this environment.",
  model_not_allowed: "Your organization does not allow the fast mode model.",
};

const COOLDOWN_TEXT = "Fast mode is paused after a rate limit.";

// Requests still run, at standard speed, so this explains why the Fast toggle has no effect.
export function deriveFastModeUnavailableNotice(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): string | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.kind !== "fast-mode.updated") continue;
    const payload = asObjectRecord(activity.payload);
    if (payload?.state === "on") return null;
    if (payload?.state === "cooldown") return `${COOLDOWN_TEXT} Requests run at standard speed.`;
    const reason = typeof payload?.disabledReason === "string" ? payload.disabledReason : null;
    const text = reason === null ? undefined : UNAVAILABLE_REASON_TEXT[reason];
    return text === undefined ? null : `${text} Requests run at standard speed.`;
  }
  return null;
}
