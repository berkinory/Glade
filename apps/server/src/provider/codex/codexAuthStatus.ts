import { asNonEmptyString } from "@glade/shared/text/text";
import { asRecord } from "@glade/shared/transport/payloadValues";
import type {
  ServerProviderAuthStatus,
  ServerProviderStatusState,
} from "@glade/contracts/server/server";
import { Option, Result } from "effect";
import {
  decodeUnknownJson,
  detailFromResult,
  extractAuthBoolean,
  extractAuthMethod,
  extractSubscriptionTypeFromOutput,
  toTitleCaseWords,
  type CommandResult,
} from "../core/providerCliOutput";

function resolveVoiceTranscriptionAvailability(
  authMethod: string | undefined,
): boolean | undefined {
  if (!authMethod) {
    return undefined;
  }
  return authMethod === "chatgpt" || authMethod === "chatgptAuthTokens";
}

const CODEX_PLAN_LABELS = new Map([
  ["free", "ChatGPT Free Subscription"],
  ["go", "ChatGPT Go Subscription"],
  ["plus", "ChatGPT Plus Subscription"],
  ["pro", "ChatGPT Pro Subscription"],
  ["team", "ChatGPT Team Subscription"],
  ["business", "ChatGPT Business Subscription"],
  ["self_serve_business_usage_based", "ChatGPT Business Subscription"],
  ["enterprise", "ChatGPT Enterprise Subscription"],
  ["enterprise_cbp_usage_based", "ChatGPT Enterprise Subscription"],
  ["edu", "ChatGPT Edu Subscription"],
  ["unknown", "ChatGPT Subscription"],
]);

function codexAccountAuthLabel(input: {
  readonly type: string | undefined;
  readonly planType: string | undefined;
}): string | undefined {
  if (input.type === "apiKey") return "OpenAI API Key";
  if (!input.planType) return undefined;
  return CODEX_PLAN_LABELS.get(input.planType) ?? toTitleCaseWords(input.planType);
}

// Current Codex CLI reports `login status` as plain text, usually on stderr, instead of JSON.
function codexPlainTextLoginMethod(result: CommandResult): "chatgpt" | "apiKey" | undefined {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (/^logged in using chatgpt\s*$/m.test(output)) return "chatgpt";
  if (/^logged in using an api key\b/m.test(output)) return "apiKey";
  return undefined;
}

function extractCodexAccountTypeFromOutput(result: CommandResult): string | undefined {
  const parsed = decodeUnknownJson(result.stdout.trim());
  if (Result.isFailure(parsed)) {
    return codexPlainTextLoginMethod(result) === "apiKey" ? "apiKey" : undefined;
  }
  const walk = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const nested = walk(entry);
        if (nested) return nested;
      }
      return undefined;
    }
    const record = Option.getOrUndefined(Option.fromNullishOr(asRecord(value)));
    if (!record) return undefined;
    const direct = Option.getOrUndefined(
      Option.firstSomeOf(
        ["type", "accountType"].map((key) => Option.fromNullishOr(asNonEmptyString(record[key]))),
      ),
    );
    if (direct) return direct;
    for (const key of ["account", "session", "auth"] as const) {
      const nested = walk(record[key]);
      if (nested) return nested;
    }
    return undefined;
  };
  return walk(parsed.success);
}

export function parseCodexAuthStatusFromOutput(result: CommandResult): {
  readonly status: ServerProviderStatusState;
  readonly authStatus: ServerProviderAuthStatus;
  readonly voiceTranscriptionAvailable?: boolean;
  readonly message?: string;
} {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (
    lowerOutput.includes("unknown command") ||
    lowerOutput.includes("unrecognized command") ||
    lowerOutput.includes("unexpected argument")
  ) {
    return {
      status: "warning",
      authStatus: "unknown",
      message: "Codex CLI authentication status command is unavailable in this Codex version.",
    };
  }

  if (
    lowerOutput.includes("not logged in") ||
    lowerOutput.includes("login required") ||
    lowerOutput.includes("authentication required") ||
    lowerOutput.includes("run `codex login`") ||
    lowerOutput.includes("run codex login")
  ) {
    return {
      status: "error",
      authStatus: "unauthenticated",
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }

  const stdout = result.stdout.trim();
  const decoded =
    stdout.startsWith("{") || stdout.startsWith("[") ? decodeUnknownJson(stdout) : undefined;
  const json = decoded && Result.isSuccess(decoded) ? decoded.success : undefined;
  const auth = extractAuthBoolean(json);

  if (auth === true) {
    const voiceTranscriptionAvailable = resolveVoiceTranscriptionAvailability(
      extractAuthMethod(json),
    );
    return {
      status: "ready",
      authStatus: "authenticated",
      ...(voiceTranscriptionAvailable !== undefined ? { voiceTranscriptionAvailable } : {}),
    };
  }
  if (auth === false) {
    return {
      status: "error",
      authStatus: "unauthenticated",
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }
  if (json !== undefined) {
    return {
      status: "warning",
      authStatus: "unknown",
      message:
        "Could not verify Codex authentication status from JSON output (missing auth marker).",
    };
  }
  if (result.code === 0) {
    // Unknown successful output stays authenticated without advertising ChatGPT-only dictation.
    const voiceTranscriptionAvailable = resolveVoiceTranscriptionAvailability(
      codexPlainTextLoginMethod(result),
    );
    return {
      status: "ready",
      authStatus: "authenticated",
      ...(voiceTranscriptionAvailable !== undefined ? { voiceTranscriptionAvailable } : {}),
    };
  }

  const detail = detailFromResult(result);
  return {
    status: "warning",
    authStatus: "unknown",
    message: detail
      ? `Could not verify Codex authentication status. ${detail}`
      : "Could not verify Codex authentication status.",
  };
}

export function codexAuthMetadata(result: CommandResult): {
  readonly type: string | undefined;
  readonly label: string | undefined;
} {
  const planType = extractSubscriptionTypeFromOutput(result);
  const accountType = extractCodexAccountTypeFromOutput(result);
  return {
    type: accountType === "apiKey" ? "apiKey" : planType,
    label: codexAccountAuthLabel({ type: accountType, planType }),
  };
}
