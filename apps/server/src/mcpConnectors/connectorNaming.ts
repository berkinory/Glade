import { OutboundHttpError } from "../platform/outboundHttp/outboundHttp.ts";
import { ConnectorSignInError } from "./connectorOAuth.ts";
import { describeUpstreamFailure } from "./connectorTransport.ts";

// The MCP server name agents see, such as `linear_connector`. The suffix keeps clear of servers the
// user configured in the provider itself, and of `glade`, which tool approval treats as Glade's own.
export function serverNameFor(name: string, taken: ReadonlyArray<string>): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 40) || "server";
  const base = `${slug}_connector`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${slug}_${index}_connector`;
    if (!used.has(candidate)) return candidate;
  }
}

export function describeSignInFailure(cause: unknown, name: string): string {
  if (cause instanceof ConnectorSignInError) return cause.message;
  if (cause instanceof OutboundHttpError) return describeUpstreamFailure(cause, name);
  const detail = cause instanceof Error ? cause.message.trim() : "";
  return detail ? `${name} rejected the sign-in: ${detail}` : `${name} rejected the sign-in.`;
}
