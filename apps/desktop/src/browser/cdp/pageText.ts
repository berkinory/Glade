import type { BrowserGetTextInput } from "@glade/contracts/browser/browserTools";
import type { CdpSession } from "./cdpSession";
import { callOn } from "./pointer";
import { rethrowStaleNode, type RefTable } from "./refs";

const DEFAULT_MAX_CHARS = 12_000;

// Rendered text of `this`, with headings marked so the model sees the outline. innerText already
// drops hidden elements and keeps line structure.
const READ_TEXT = `function () {
  const root = this;
  if (!root) return "";
  if (typeof root.innerText !== "string") return (root.textContent || "").trim();
  const headings = new Map(Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6"), (h) => [h.innerText.trim(), "#".repeat(Number(h.tagName[1]))]));
  return root.innerText.split("\\n").map((line) => {
    const text = line.trim();
    const marker = text && headings.get(text);
    return marker ? marker + " " + text : text;
  }).join("\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
}`;

// The page's main content (falling back to the body), or the subtree of `ref`.
export async function readPageText(
  cdp: CdpSession,
  refs: RefTable,
  input: Pick<typeof BrowserGetTextInput.Type, "maxChars" | "ref">,
): Promise<string> {
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
  let value: unknown;
  if (input.ref) {
    value = await callOn<unknown>(cdp, refs.resolve(input.ref), READ_TEXT).catch(
      rethrowStaleNode(input.ref),
    );
  } else {
    const { result } = await cdp.send<{ result: { value?: unknown } }>("Runtime.evaluate", {
      expression: `(${READ_TEXT}).call(document.querySelector("main, [role=main], article") || document.body)`,
      returnByValue: true,
    });
    value = result.value;
  }
  const text = typeof value === "string" ? value : "";
  if (!text) return "(no readable text)";
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n… ${text.length - maxChars} more characters; raise maxChars or use browser_find.`
    : text;
}
