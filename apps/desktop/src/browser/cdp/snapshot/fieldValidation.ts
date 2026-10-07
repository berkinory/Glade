import type { CdpSession } from "../cdpSession";
import { elementIds } from "../remoteElements";

const MAX_MESSAGE_CHARS = 100;

// Invalid fields of a session's main document, its same-origin frames and open shadow roots: an
// explicit aria-invalid, or a native constraint failure on a field that has a value or that the
// user already interacted with (an untouched required field is shown as `required`). The message
// is the aria-errormessage text, else the browser's validationMessage (never for passwords), else
// the aria-describedby text. Returns an array of the fields carrying the messages as `messages`.
const INVALID_FIELDS = `(() => {
  const fields = [];
  const messages = [];
  const text = (doc, ids) => (ids || "").split(/\\s+/).filter(Boolean).map((id) => doc.getElementById(id)).filter(Boolean)
    .map((el) => (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim()).filter(Boolean).join(" ");
  const visit = (root, doc, depth) => {
    for (const el of root.querySelectorAll("input, select, textarea, [aria-invalid]")) {
      const aria = ["true", "grammar", "spelling"].includes((el.getAttribute("aria-invalid") || "").toLowerCase());
      const native = el.willValidate && el.validity && !el.validity.valid && (el.value !== "" || el.matches(":user-invalid"));
      if (!aria && !native) continue;
      const message = text(doc, el.getAttribute("aria-errormessage"))
        || (native && el.type !== "password" ? el.validationMessage : "")
        || text(doc, el.getAttribute("aria-describedby"));
      fields.push(el);
      messages.push(message);
    }
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) visit(el.shadowRoot, doc, depth);
      if (el.localName === "iframe" && depth < 3) {
        let inner = null;
        try { inner = el.contentDocument; } catch {}
        if (inner) visit(inner, inner, depth + 1);
      }
    }
  };
  visit(document, document, 0);
  fields.messages = messages;
  return fields;
})()`;

// Backend node id of each invalid field with its message ("" when the page gives none).
export async function invalidFields(
  cdp: CdpSession,
  sessionId: string | undefined,
): Promise<Map<number, string>> {
  const { result } = await cdp.send<{ result: { objectId?: string } }>(
    "Runtime.evaluate",
    { expression: INVALID_FIELDS },
    sessionId,
  );
  const invalid = new Map<number, string>();
  if (!result.objectId) return invalid;
  const [ids, messages] = await Promise.all([
    elementIds(cdp, sessionId, result.objectId),
    cdp.send<{ result: { value?: string[] } }>(
      "Runtime.callFunctionOn",
      {
        objectId: result.objectId,
        functionDeclaration: "function () { return this.messages; }",
        returnByValue: true,
      },
      sessionId,
    ),
  ]);
  ids.forEach((id, index) => {
    if (id === null || id === undefined) return;
    const message = messages.result.value?.[index] ?? "";
    invalid.set(
      id,
      message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS - 1)}…` : message,
    );
  });
  return invalid;
}
