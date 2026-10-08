import { BrowserFailure, withTimeout } from "../browserFailure";
import { isLocalPageUrl } from "../browserUrlPolicy";
import type { PageRead } from "./buffers";
import type { CdpSession } from "./cdpSession";

const EVALUATE_TIMEOUT_MS = 10_000;
const MAX_RESULT_CHARS = 20_000;
const MAX_ERROR_CHARS = 1_000;

interface RemoteValue {
  readonly type: string;
  readonly value?: unknown;
  readonly unserializableValue?: string;
  readonly description?: string;
}

interface EvaluateResponse {
  readonly result: RemoteValue;
  readonly exceptionDetails?: { readonly text: string; readonly exception?: RemoteValue };
}

const NOT_LOCAL =
  "browser_evaluate only runs on localhost pages (localhost, *.localhost, 127.0.0.1, [::1]). Use browser_snapshot, browser_find or browser_get_text on other pages.";

const clip = (text: string, max: number) =>
  text.length > max
    ? `${text.slice(0, max)}\n… ${text.length - max} more characters truncated; return a smaller value.`
    : text;

function formatValue(result: RemoteValue): string {
  if (result.unserializableValue) return result.unserializableValue;
  if (result.type === "undefined") return "undefined";
  if (typeof result.value === "string") return result.value;
  return JSON.stringify(result.value, null, 2) ?? result.description ?? result.type;
}

// Runs in the main frame's own world, never an iframe. The local check holds for the very context
// the script runs in: the frame URL and the context's origin are both checked, and evaluating by
// contextId fails if a navigation replaced that context in between.
export async function evaluateOnLocalPage(cdp: CdpSession, expression: string): Promise<PageRead> {
  const { frameTree } = await cdp.send<{ frameTree: { frame: { id: string; url: string } } }>(
    "Page.getFrameTree",
  );
  const context = cdp.mainWorld(frameTree.frame.id);
  if (!isLocalPageUrl(frameTree.frame.url) || !context || !isLocalPageUrl(context.origin)) {
    throw new BrowserFailure("evaluate_not_local", NOT_LOCAL);
  }
  const response = await withTimeout(
    cdp.send<EvaluateResponse>("Runtime.evaluate", {
      expression,
      contextId: context.id,
      returnByValue: true,
      awaitPromise: true,
      timeout: EVALUATE_TIMEOUT_MS,
    }),
    EVALUATE_TIMEOUT_MS,
    "The script",
  ).catch((error: unknown) => {
    if (error instanceof BrowserFailure) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserFailure(
      "script_error",
      /context|navigated/iu.test(message)
        ? "The page navigated before the script finished; nothing was returned."
        : `The script's result could not be returned: ${clip(message, MAX_ERROR_CHARS)}`,
    );
  });
  if (response.exceptionDetails) {
    const { text, exception } = response.exceptionDetails;
    throw new BrowserFailure(
      "script_error",
      `The script threw: ${clip(exception?.description ?? text, MAX_ERROR_CHARS)}`,
    );
  }
  return { content: clip(formatValue(response.result), MAX_RESULT_CHARS), note: "" };
}
