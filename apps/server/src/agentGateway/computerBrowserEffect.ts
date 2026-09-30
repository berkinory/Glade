import { asRecord } from "@glade/shared/transport/recordValues";
import type { ComputerBrowserToolName } from "@glade/contracts/computer/computerBrowser";

import type { ComputerBrowserCallResult } from "../computer/ComputerBackend.ts";
import type { ComputerAuditEffect } from "../computer/computerAuditLog.ts";

interface BrowserEffectProof {
  readonly effect: ComputerAuditEffect;
  readonly code?: string;
}

export function computerBrowserEffect(
  name: ComputerBrowserToolName,
  args: Record<string, unknown>,
  result: ComputerBrowserCallResult,
): BrowserEffectProof {
  const structured = asRecord(result.structuredContent) ?? undefined;
  const refusal = asRecord(structured?.refusal) ?? undefined;
  const detail = asRecord(refusal?.detail) ?? undefined;
  if (
    structured?.effect === "partial" ||
    (structured?.status === "refused" &&
      refusal?.code === "browser_input_incomplete" &&
      typeof detail?.delivered_chars === "number" &&
      detail.delivered_chars > 0)
  ) {
    return { effect: "dispatched-unknown" };
  }
  if (structured?.status === "refused" || structured?.effect === "refused") {
    return {
      effect: "refused",
      code:
        typeof refusal?.code === "string"
          ? refusal.code
          : typeof structured.code === "string"
            ? structured.code
            : "browser_refused",
    };
  }
  if (result.isError === true) {
    return {
      effect: "error",
      code: typeof structured?.error === "string" ? structured.error : "browser_error",
    };
  }
  if (
    name === "computer_browser_download" &&
    structured?.status === "completed" &&
    typeof structured.download_id === "string" &&
    structured.download_id.length > 0 &&
    typeof structured.bytes === "number" &&
    Number.isSafeInteger(structured.bytes) &&
    structured.bytes >= 0
  ) {
    return { effect: "verified" };
  }
  const verification = asRecord(structured?.verification) ?? undefined;
  if (
    name === "computer_browser_navigate" &&
    structured?.status === "ok" &&
    typeof args.target_id === "string" &&
    structured.target_id === args.target_id &&
    typeof args.tab_id === "string" &&
    structured.tab_id === args.tab_id &&
    typeof args.url === "string" &&
    structured.url === args.url &&
    verification?.scope === "navigation" &&
    verification.method === "page_frame_tree" &&
    verification.status === "confirmed"
  ) {
    return { effect: "verified" };
  }

  return { effect: "dispatched-unknown" };
}

export function computerBrowserFieldReadback(
  name: ComputerBrowserToolName,
  args: Record<string, unknown>,
  result: ComputerBrowserCallResult,
): boolean {
  const structured = asRecord(result.structuredContent) ?? undefined;
  return (
    name === "computer_browser_type" &&
    typeof args.text === "string" &&
    (args.mode === undefined || args.mode === "insert_text") &&
    args.replace === true &&
    args.input_route === "dom_event" &&
    result.isError !== true &&
    structured?.effect === "unverifiable" &&
    structured.route === "dom" &&
    Array.isArray(structured.evidence) &&
    structured.evidence.some((item) => (asRecord(item) ?? undefined)?.kind === "value_readback")
  );
}
