import { asObjectRecord } from "@glade/shared/transport/payloadValues";

export type GladeMcpToolStatus = "running" | "completed" | "failed" | "cancelled";

// One Glade gateway tool call as the timeline sees it, whichever provider ran it.
export interface GatewayToolCall {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly output: string | null;
  readonly status: GladeMcpToolStatus;
}

export interface GatewayToolPresentation {
  readonly heading: string;
  readonly preview: string | null;
}

// [running, completed, object of "Couldn't …"].
export type GatewayToolWording = readonly [string, string, string];

const PREVIEW_MAX_CHARS = 80;

function contentText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const parts = value.flatMap((part) => {
    const record = asObjectRecord(part);
    return typeof record?.text === "string" ? [record.text] : [];
  });
  return parts.length > 0 ? parts.join("\n") : null;
}

// Claude reports `data.input` and `data.result.content`; Codex reports the MCP item with its
// `arguments`, `result.content` and `error.message`, or a dynamic tool's `contentItems`.
export function gatewayToolCall(
  tool: string,
  payload: Record<string, unknown> | null,
  status: GladeMcpToolStatus,
): GatewayToolCall {
  const data = asObjectRecord(payload?.data);
  const item = asObjectRecord(data?.item);
  const args = asObjectRecord(data?.input) ?? asObjectRecord(item?.arguments) ?? {};
  const result = data?.result ?? item?.result;
  const output =
    contentText(asObjectRecord(result)?.content ?? result) ??
    contentText(item?.contentItems) ??
    contentText(asObjectRecord(item?.error)?.message) ??
    null;
  return { tool: tool.replace(/^glade_/u, ""), args, output, status };
}

const ENVELOPE_START = /^--- ([A-Z]+_CONTENT) nonce=([0-9a-f]+)\b.*---$/u;

// Drops PAGE_CONTENT / APP_CONTENT blocks so only Glade's own report lines remain. A block cut off
// by payload truncation runs to the end of the text.
export function stripUntrustedContent(output: string): string[] {
  const lines: string[] = [];
  let endMarker: string | null = null;
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (endMarker !== null) {
      if (line === endMarker) endMarker = null;
      continue;
    }
    const start = ENVELOPE_START.exec(line);
    if (start) {
      endMarker = `--- END ${start[1]} nonce=${start[2]} ---`;
      continue;
    }
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

export function shortPreview(value: string): string {
  const single = value.replace(/\s+/gu, " ").trim();
  return single.length > PREVIEW_MAX_CHARS
    ? `${single.slice(0, PREVIEW_MAX_CHARS - 1).trimEnd()}…`
    : single;
}

// A row reads `<heading> <what> · <where>`, or `<heading> · <where>` when only the place (a page
// host, an app) is known.
export function previewAt(what: string | null, where: string | null): string | null {
  if (!what) return where ? `· ${where}` : null;
  return where ? `${what} · ${where}` : what;
}

// Refusals the user should read in their own words rather than the message written for the agent.
const REFUSAL_LABELS: Readonly<Record<string, string>> = {
  no_progress: "Stopped repeating an action that had no effect",
  user_active: "Waited for you to stop using the mouse or keyboard",
  browser_read_only: "Browsers are read-only for Computer Use",
  click_only: "Terminals and code editors are click-only for Computer Use",
  covered: "Something on the page was covering it",
  user_picking: "Waited for you to finish picking an element",
  stale_ref: "The page changed before the action",
};

// Gateway refusals arrive as `{"error":{"code","message"}}` (a failed browser_batch step as
// `[2/3] browser_click failed (<code>): …`); anything else reads as plain text.
function gatewayToolErrorMessage(output: string | null): string | null {
  if (!output) return null;
  const text = output.trim();
  let message: string = text;
  let code = /^\[\d+\/\d+\] \S+ failed \(([a-z_]+)\)/u.exec(text)?.[1] ?? null;
  if (text.startsWith("{")) {
    try {
      const error = asObjectRecord(asObjectRecord(JSON.parse(text))?.error);
      if (typeof error?.message === "string") message = error.message;
      if (typeof error?.code === "string") code = error.code;
    } catch {
      message = text;
    }
  }
  if (code && Object.hasOwn(REFUSAL_LABELS, code)) return REFUSAL_LABELS[code]!;
  const first = stripUntrustedContent(message)[0];
  return first ? shortPreview(first) : null;
}

export function presentGatewayToolCall(
  wording: GatewayToolWording,
  call: GatewayToolCall,
  preview: string | null,
): GatewayToolPresentation {
  const [running, completed, failed] = wording;
  switch (call.status) {
    case "running":
      return { heading: running, preview };
    case "completed":
      return { heading: completed, preview };
    case "failed":
      return {
        heading: `Couldn't ${failed}`,
        preview: gatewayToolErrorMessage(call.output) ?? preview,
      };
    case "cancelled":
      return { heading: `Stopped ${running.charAt(0).toLowerCase()}${running.slice(1)}`, preview };
  }
}

export const stringArg = (args: GatewayToolCall["args"], key: string): string | null =>
  typeof args[key] === "string" && args[key].trim().length > 0 ? args[key].trim() : null;
