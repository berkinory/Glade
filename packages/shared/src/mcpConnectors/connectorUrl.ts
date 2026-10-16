export type McpConnectorUrlCheck =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

// Custom servers must be public HTTPS endpoints. The server still pins every request to a public
// address; this check gives the person typing the URL an early, readable answer.
export function normalizeMcpConnectorUrl(input: string): McpConnectorUrlCheck {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: "Enter the server's URL." };
  if (trimmed.length > 2048) return { ok: false, reason: "The URL is too long." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "Enter a full URL, starting with https://." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "The URL must start with https://." };
  if (url.username || url.password) {
    return { ok: false, reason: "Remove the user name and password from the URL." };
  }
  url.hash = "";
  return { ok: true, url: url.toString() };
}
