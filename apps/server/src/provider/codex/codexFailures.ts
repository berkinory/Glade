import type {
  ProviderFailure,
  ProviderFailureKind,
} from "@glade/contracts/provider/providerFailure";
import type { ErrorNotification } from "./protocol/generated/types/v2/ErrorNotification";

function nativeKind(info: ErrorNotification["error"]["codexErrorInfo"]): ProviderFailureKind {
  const variant = typeof info === "string" ? info : info ? Object.keys(info)[0] : undefined;
  switch (variant) {
    case "unauthorized":
      return "auth_required";
    case "cyberPolicy":
    case "misalignmentPolicyViolation":
    case "sandboxError":
      return "access_denied";
    case "usageLimitExceeded":
    case "sessionBudgetExceeded":
      return "quota_exhausted";
    case "rateLimitExceeded":
      return "rate_limited";
    case "flexUnavailable":
    case "serverOverloaded":
      return "overloaded";
    case "contextWindowExceeded":
      return "context_exhausted";
    case "badRequest":
      return "bad_request";
    case "httpConnectionFailed":
    case "responseStreamConnectionFailed":
    case "responseStreamDisconnected":
      return "connection_lost";
    default:
      return "internal";
  }
}

function nativeHttpStatus(info: ErrorNotification["error"]["codexErrorInfo"]): number | null {
  if (!info || typeof info === "string") return null;
  for (const value of Object.values(info)) {
    if (value && typeof value === "object" && "httpStatusCode" in value) {
      const status = value.httpStatusCode;
      return typeof status === "number" &&
        Number.isInteger(status) &&
        status >= 100 &&
        status <= 599
        ? status
        : null;
    }
  }
  return null;
}

export function normalizeCodexFailure(error: ErrorNotification, message: string): ProviderFailure {
  const kind = nativeKind(error.error.codexErrorInfo);
  const action: ProviderFailure["action"] =
    kind === "auth_required"
      ? "login"
      : kind === "rate_limited" || kind === "overloaded" || kind === "quota_exhausted"
        ? "wait"
        : kind === "context_exhausted"
          ? "compact"
          : kind === "model_unavailable"
            ? "choose_model"
            : null;
  return {
    kind,
    retry: error.willRetry ? { state: "retrying" } : { state: "none" },
    action,
    resetsAt: null,
    httpStatus: nativeHttpStatus(error.error.codexErrorInfo),
    message: message.trim() || "Codex reported an error.",
  };
}
