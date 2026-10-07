import type { CdpSession } from "./cdpSession";

const DEFAULT_MAX_CHARS = 12_000;

// Rendered text of the main content (falls back to the body), with headings marked so the model
// sees the page outline. innerText already drops hidden elements and keeps line structure.
const READ_TEXT = `(() => {
  const root = document.querySelector("main, [role=main], article") || document.body;
  if (!root) return "";
  const headings = new Map(Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6"), (h) => [h.innerText.trim(), "#".repeat(Number(h.tagName[1]))]));
  return root.innerText.split("\\n").map((line) => {
    const text = line.trim();
    const marker = text && headings.get(text);
    return marker ? marker + " " + text : text;
  }).join("\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
})()`;

export async function readPageText(cdp: CdpSession, maxChars = DEFAULT_MAX_CHARS): Promise<string> {
  const { result } = await cdp.send<{ result: { value?: unknown } }>("Runtime.evaluate", {
    expression: READ_TEXT,
    returnByValue: true,
  });
  const text = typeof result.value === "string" ? result.value : "";
  if (!text) return "(no readable text)";
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n… ${text.length - maxChars} more characters; raise maxChars or use browser_find.`
    : text;
}
