import type {
  BrowserConsoleInput,
  BrowserNetworkInput,
} from "@glade/contracts/browser/browserTools";
import { BrowserFailure } from "../browserFailure";
import type { CdpSession } from "./cdpSession";

const CAPACITY = 500;
const MAX_ENTRY_CHARS = 2_000;
const MAX_BODY_CHARS = 20_000;
const PAGE_SIZE = 20;

// Glade's note about the read, kept apart from the page-derived lines.
export interface PageRead {
  readonly content: string;
  readonly note: string;
}

// Page 1 is the newest PAGE_SIZE lines; each page keeps chronological order.
function paginate(lines: readonly string[], page = 1, noun: string, hint: string): PageRead {
  if (lines.length === 0) return { content: "", note: `No ${noun} recorded.` };
  const pages = Math.ceil(lines.length / PAGE_SIZE);
  const current = Math.min(page, pages);
  const end = lines.length - (current - 1) * PAGE_SIZE;
  const start = Math.max(0, end - PAGE_SIZE);
  const older = current < pages ? ` Older ones: page ${current + 1}.` : "";
  return {
    content: lines.slice(start, end).join("\n"),
    note: `${noun[0]!.toUpperCase()}${noun.slice(1)} ${start + 1}–${end} of ${lines.length}, oldest first.${older}${hint}`,
  };
}

type Level = "error" | "warning" | "info" | "debug";
interface ConsoleEntry {
  readonly level: Level;
  readonly text: string;
}
interface NetworkEntry {
  readonly requestId: string;
  readonly sessionId: string | undefined;
  readonly method: string;
  url: string;
  readonly type: string;
  status?: number;
  failure?: string;
}
interface RemoteObject {
  readonly value?: unknown;
  readonly description?: string;
  readonly unserializableValue?: string;
  readonly type?: string;
}

const CONSOLE_LEVELS: Record<string, Level> = {
  error: "error",
  assert: "error",
  warning: "warning",
  warn: "warning",
  debug: "debug",
  verbose: "debug",
  trace: "debug",
};

const clip = (text: string) =>
  text.length > MAX_ENTRY_CHARS ? `${text.slice(0, MAX_ENTRY_CHARS)}…` : text;

function remoteText(arg: RemoteObject): string {
  if (arg.value !== undefined)
    return typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value);
  return arg.unserializableValue ?? arg.description ?? arg.type ?? "";
}

function patternFilter(pattern: string | undefined): (text: string) => boolean {
  if (!pattern) return () => true;
  const needle = pattern.toLowerCase();
  return (text) => text.toLowerCase().includes(needle);
}

// Bounded per-tab console and network history, filled from CDP events once the debugger is
// attached and read on demand. Response bodies stay in the renderer until a read asks for one.
export class PageBuffers {
  private consoleEntries: ConsoleEntry[] = [];
  private readonly requests = new Map<string, NetworkEntry>();

  constructor(private readonly cdp: CdpSession) {
    cdp.on((method, params, sessionId) => {
      switch (method) {
        case "Page.frameNavigated":
          if (sessionId === undefined && !params.frame.parentId) this.consoleEntries = [];
          break;
        case "Runtime.consoleAPICalled":
          this.log(
            CONSOLE_LEVELS[params.type] ?? "info",
            (params.args as RemoteObject[]).map(remoteText).join(" "),
          );
          break;
        case "Runtime.exceptionThrown":
          this.log(
            "error",
            params.exceptionDetails.exception?.description ?? params.exceptionDetails.text,
          );
          break;
        case "Log.entryAdded":
          this.log(
            CONSOLE_LEVELS[params.entry.level] ?? "info",
            `${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ""}`,
          );
          break;
        case "Network.requestWillBeSent":
          this.track({
            requestId: params.requestId,
            sessionId,
            method: params.request.method,
            url: params.request.url,
            type: String(params.type ?? "Other"),
          });
          break;
        case "Network.responseReceived": {
          const entry = this.requests.get(`${sessionId ?? ""}:${params.requestId}`);
          if (entry) entry.status = params.response.status;
          break;
        }
        case "Network.loadingFailed": {
          const entry = this.requests.get(`${sessionId ?? ""}:${params.requestId}`);
          if (entry) entry.failure = params.canceled ? "canceled" : String(params.errorText);
          break;
        }
      }
    });
  }

  readConsole(input: typeof BrowserConsoleInput.Type): PageRead {
    const matches = patternFilter(input.pattern);
    const entries = this.consoleEntries.filter(
      (entry) =>
        (input.level === undefined || input.level === "all" || entry.level === input.level) &&
        matches(entry.text),
    );
    if (input.clear) this.consoleEntries = [];
    // A message logged in a loop is one line with a count.
    const lines: string[] = [];
    let repeats = 0;
    entries.forEach((entry, index) => {
      const next = entries[index + 1];
      if (next && next.level === entry.level && next.text === entry.text) {
        repeats += 1;
        return;
      }
      lines.push(`[${entry.level}] ${entry.text}${repeats > 0 ? ` (×${repeats + 1})` : ""}`);
      repeats = 0;
    });
    return paginate(lines, input.page, "console messages", "");
  }

  async readNetwork(input: typeof BrowserNetworkInput.Type): Promise<PageRead> {
    if (input.requestId) return { content: await this.readBody(input.requestId), note: "" };
    const matches = patternFilter(input.pattern);
    const lines = [...this.requests.values()]
      .filter(
        (entry) =>
          matches(entry.url) &&
          (!input.failedOnly || entry.failure !== undefined || (entry.status ?? 0) >= 400),
      )
      .map(
        (entry) =>
          `${entry.requestId} ${entry.method} ${entry.failure ?? entry.status ?? "pending"} ${entry.type} ${clip(entry.url)}`,
      );
    return paginate(lines, input.page, "requests", " Pass requestId to read a response body.");
  }

  private async readBody(requestId: string): Promise<string> {
    const entry = [...this.requests.values()].find(
      (candidate) => candidate.requestId === requestId,
    );
    if (!entry) throw new BrowserFailure("invalid_input", `No recorded request ${requestId}.`);
    const { body, base64Encoded } = await this.cdp
      .send<{ body: string; base64Encoded: boolean }>(
        "Network.getResponseBody",
        { requestId },
        entry.sessionId,
      )
      .catch((error: unknown) => {
        throw new BrowserFailure(
          "invalid_input",
          `The body of ${requestId} is not available: ${(error as Error).message}`,
        );
      });
    if (base64Encoded)
      return `${entry.url}\n(binary body, ${Math.floor((body.length * 3) / 4)} bytes; not shown)`;
    const shown =
      body.length > MAX_BODY_CHARS
        ? `${body.slice(0, MAX_BODY_CHARS)}\n… ${body.length - MAX_BODY_CHARS} more characters`
        : body;
    return `${entry.url}\n${shown}`;
  }

  private log(level: Level, text: string): void {
    this.consoleEntries.push({ level, text: clip(text) });
    if (this.consoleEntries.length > CAPACITY)
      this.consoleEntries.splice(0, this.consoleEntries.length - CAPACITY);
  }

  private track(entry: NetworkEntry): void {
    const key = `${entry.sessionId ?? ""}:${entry.requestId}`;
    // Redirects reuse the request id; the latest hop replaces the earlier one.
    this.requests.delete(key);
    this.requests.set(key, entry);
    if (this.requests.size > CAPACITY) this.requests.delete(this.requests.keys().next().value!);
  }
}
