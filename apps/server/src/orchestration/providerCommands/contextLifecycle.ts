import { ThreadId, TurnId, ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type RuntimeMode } from "@glade/contracts/provider/sessionPolicy";

export const PROVIDER_CONTEXT_LIFECYCLE_ACTIVITY_KIND = "provider.context.changed";

const SESSION_CONTEXT_RECAP_PREVIEW_MAX_CHARS = 600;

export type ProviderContextLifecycleReason =
  | "fresh-session"
  | "interrupt-escalation"
  | "native-history-unavailable"
  | "native-resume-failed";

export interface ProviderContextLifecycleEvidence {
  readonly nativeHistory: "available" | "unavailable";
  readonly recapText: string | null;
  readonly reason: ProviderContextLifecycleReason;
  readonly sessionRestarted: boolean;
}

export interface ProviderContextLifecycleActivityInput {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly provider: ProviderKind;
  readonly evidence: ProviderContextLifecycleEvidence;
  readonly createdAt: string;
  readonly completeDurablePriorTranscript?: boolean;
}

export interface ProviderContextLifecycleActivityRecord {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly provider: ProviderKind;
  readonly nativeHistory: "available" | "unavailable";
  readonly sessionRestarted: boolean;
  readonly restartReason: ProviderContextLifecycleReason;
  readonly recapInjected: boolean;
  readonly recapCharacters: number;
  readonly recapPreview: string | null;
  readonly recapPreviewTruncated: boolean;
  readonly summary: string;
  readonly createdAt: string;
  readonly completeDurablePriorTranscript: boolean;
}

export function recapTailPreview(recapText: string): string {
  const normalized = recapText.trim();
  if (normalized.length <= SESSION_CONTEXT_RECAP_PREVIEW_MAX_CHARS) {
    return normalized;
  }
  return `…${normalized.slice(-(SESSION_CONTEXT_RECAP_PREVIEW_MAX_CHARS - 1)).trimStart()}`;
}

export function providerContextLifecycleSummary(
  evidence: ProviderContextLifecycleEvidence,
): string {
  if (evidence.reason === "interrupt-escalation") {
    return evidence.recapText !== null
      ? "The turn could not be stopped cleanly, so the session was restarted and your message included a summary."
      : "The turn could not be stopped cleanly, so the session was restarted.";
  }
  if (evidence.recapText !== null && evidence.nativeHistory === "unavailable") {
    return "The session's history was lost, so the model continues from a summary.";
  }
  if (evidence.recapText !== null && evidence.sessionRestarted) {
    return "The session was restarted, so your message included a summary.";
  }
  if (evidence.recapText !== null) {
    return "Your message included a summary while the session recovered its context.";
  }
  return evidence.sessionRestarted
    ? "The session restarted without its previous history."
    : "The session's history was unavailable for this turn.";
}

export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
