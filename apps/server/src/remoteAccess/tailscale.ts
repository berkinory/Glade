import { existsSync } from "node:fs";
import path from "node:path";

import { resolveExecutable } from "@glade/shared/platform/executable";

import { runProcess } from "../platform/processRunner";

const CLI_TIMEOUT_MS = 15_000;
const HTTPS_PORT = 443;
const SERVE_SETUP_URL = /https:\/\/login\.tailscale\.com\/f\/serve\S*/;

export interface TailscaleNode {
  readonly state: "not-installed" | "stopped" | "running";
  // The node's MagicDNS name without the trailing dot, when it is running.
  readonly dnsName: string | null;
  // What Tailscale HTTPS on port 443 currently proxies to, if anything.
  readonly httpsProxy: string | null;
}

export type TailscaleServeResult =
  | { readonly kind: "serving"; readonly url: string }
  | { readonly kind: "needs-setup"; readonly setupUrl: string }
  | { readonly kind: "failed"; readonly message: string };

// The Mac app and the Windows installer put the CLI outside PATH.
function platformCliCandidates(): ReadonlyArray<string> {
  if (process.platform === "darwin") {
    return ["/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
  }
  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    return [path.join(programFiles, "Tailscale", "tailscale.exe")];
  }
  return [];
}

export function resolveTailscaleCli(): string | null {
  return resolveExecutable("tailscale") ?? platformCliCandidates().find(existsSync) ?? null;
}

export function localProxyTarget(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readHttpsProxy(serveStatus: unknown, dnsName: string): string | null {
  const web = (serveStatus as { Web?: Record<string, unknown> } | null)?.Web;
  const site = web?.[`${dnsName}:${HTTPS_PORT}`] as
    | { Handlers?: Record<string, { Proxy?: unknown }> }
    | undefined;
  const proxy = site?.Handlers?.["/"]?.Proxy;
  return typeof proxy === "string" ? proxy : null;
}

export async function readTailscaleNode(cli: string | null): Promise<TailscaleNode> {
  if (!cli) return { state: "not-installed", dnsName: null, httpsProxy: null };
  const status = await runProcess(cli, ["status", "--json"], {
    timeoutMs: CLI_TIMEOUT_MS,
    allowNonZeroExit: true,
  }).catch(() => null);
  const parsed = status ? (parseJson(status.stdout) as Record<string, unknown> | null) : null;
  const self = parsed?.Self as { DNSName?: unknown } | undefined;
  const dnsName =
    typeof self?.DNSName === "string" && self.DNSName.length > 0
      ? self.DNSName.replace(/\.$/, "")
      : null;
  if (parsed?.BackendState !== "Running" || !dnsName) {
    return { state: "stopped", dnsName: null, httpsProxy: null };
  }
  const serve = await runProcess(cli, ["serve", "status", "--json"], {
    timeoutMs: CLI_TIMEOUT_MS,
    allowNonZeroExit: true,
  }).catch(() => null);
  return {
    state: "running",
    dnsName,
    httpsProxy: serve ? readHttpsProxy(parseJson(serve.stdout), dnsName) : null,
  };
}

// Maps https://<node>.ts.net/ to the remote listener. Tailscale terminates TLS with a certificate
// for the node's name, so devices on the tailnet get HTTPS without any setup on their side.
export async function serveHttps(cli: string, port: number): Promise<TailscaleServeResult> {
  // When the tailnet has Serve turned off, the CLI prints an enable link and waits for the user.
  // Stop it as soon as the link appears; the user enables Serve in the browser and retries.
  let output = "";
  const stopWaiting = new AbortController();
  const collect = (chunk: string) => {
    output += chunk;
    if (SERVE_SETUP_URL.test(output)) stopWaiting.abort();
  };
  await runProcess(cli, ["serve", "--bg", `--https=${HTTPS_PORT}`, localProxyTarget(port)], {
    timeoutMs: CLI_TIMEOUT_MS,
    allowNonZeroExit: true,
    signal: stopWaiting.signal,
    onStdoutChunk: collect,
    onStderrChunk: collect,
  }).catch((error: unknown) => {
    if (!stopWaiting.signal.aborted) {
      output += `\n${error instanceof Error ? error.message : String(error)}`;
    }
  });
  const setupUrl = output.match(SERVE_SETUP_URL)?.[0];
  if (setupUrl) return { kind: "needs-setup", setupUrl };
  const node = await readTailscaleNode(cli);
  if (node.dnsName && node.httpsProxy === localProxyTarget(port)) {
    return { kind: "serving", url: `https://${node.dnsName}` };
  }
  // Linux only lets root or the configured operator change Serve.
  if (/access denied/i.test(output)) {
    return {
      kind: "failed",
      message:
        'Tailscale needs permission first. Run "sudo tailscale set --operator=$USER" on this machine, then try again.',
    };
  }
  const reason = output
    .trim()
    .split("\n")
    .find((line) => line.trim().length > 0);
  return { kind: "failed", message: reason ?? "Tailscale did not start serving HTTPS." };
}

export async function stopServingHttps(cli: string): Promise<void> {
  await runProcess(cli, ["serve", `--https=${HTTPS_PORT}`, "off"], {
    timeoutMs: CLI_TIMEOUT_MS,
    allowNonZeroExit: true,
  });
}
