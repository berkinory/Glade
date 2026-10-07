import type { BrowserPickedDetails } from "@glade/contracts/browser/browserView";
import type { CdpSession } from "./cdpSession";

// Sent as source and run once on the picked element, so it must stay self-contained. Everything it
// reads is page data. Work is bounded (candidate caps, early breaks) so a huge page stays fast.
function readDetails(el: Element, accessibleName: string): BrowserPickedDetails {
  const squash = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const clip = (value: string, max: number) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;
  const root = el.getRootNode() as Document | ShadowRoot;
  const select = (selector: string) => {
    try {
      return root.querySelectorAll(selector);
    } catch {
      return null;
    }
  };
  const isOnly = (selector: string) => {
    const found = select(selector);
    return found?.length === 1 && found[0] === el;
  };

  // Selector: stable hooks first, nth-of-type only where a level is otherwise ambiguous.
  const plain = (value: string | null): value is string =>
    value !== null && /^[^"\\\n\r]{1,60}$/.test(value);
  const idLike = (token: string) => /^[A-Za-z][\w-]{0,39}$/.test(token) && !/\d{4,}/.test(token);
  const semantic = (token: string) =>
    idLike(token) &&
    !/^(?:css|sc|jsx|emotion|svelte|tw)-/i.test(token) &&
    !/__[A-Za-z0-9]{5,}$/.test(token);
  const hooks = (node: Element): string[] => {
    const tag = CSS.escape(node.localName);
    const list: string[] = [];
    for (const name of ["data-testid", "data-test-id", "data-test", "data-qa", "data-cy"]) {
      const value = node.getAttribute(name);
      if (plain(value)) list.push(`[${name}="${value}"]`);
    }
    if (idLike(node.id)) list.push(`#${CSS.escape(node.id)}`);
    for (const attribute of Array.from(node.attributes)) {
      if (list.length > 4) break;
      if (!attribute.name.startsWith("data-") || !/^[\w-]+$/.test(attribute.name)) continue;
      if (plain(attribute.value) && attribute.value.length <= 40 && !/^[{[]/.test(attribute.value))
        list.push(`${tag}[${attribute.name}="${attribute.value}"]`);
    }
    for (const name of ["aria-label", "name"]) {
      const value = node.getAttribute(name);
      if (plain(value)) list.push(`${tag}[${name}="${value}"]`);
    }
    const classes = Array.from(node.classList).filter(semantic).slice(0, 2);
    if (classes.length > 0) list.push(`${tag}${classes.map((c) => `.${CSS.escape(c)}`).join("")}`);
    list.push(tag);
    return list;
  };
  const findSelector = (): string | null => {
    const direct = hooks(el).find(isOnly);
    if (direct) return direct;
    const parts: string[] = [];
    for (let node: Element | null = el; node && parts.length < 16; node = node.parentElement) {
      const options = hooks(node);
      const anchor = options.find((option) => select(option)?.length === 1);
      if (anchor) {
        parts.unshift(anchor);
        break;
      }
      let part = options[0]!;
      const parent: Element | null = node.parentElement;
      if (parent && (parent.querySelectorAll(`:scope > ${part}`).length ?? 0) > 1) {
        let index = 1;
        for (
          let sibling = node.previousElementSibling;
          sibling;
          sibling = sibling.previousElementSibling
        )
          if (sibling.localName === node.localName) index += 1;
        part += `:nth-of-type(${index})`;
      }
      parts.unshift(part);
    }
    let segments = parts.map((part, index) => ({ part, joint: index === 0 ? "" : " > " }));
    const join = (list: typeof segments) => list.map((s) => s.joint + s.part).join("");
    if (!isOnly(join(segments))) return null;
    for (let drop = segments.length - 2; drop >= 0; drop -= 1) {
      const trial = segments
        .filter((_, index) => index !== drop)
        .map((s, index) => (index === drop ? { ...s, joint: drop === 0 ? "" : " " } : s));
      if (isOnly(join(trial))) segments = trial;
    }
    return join(segments);
  };

  const textById = (ids: string | null) =>
    squash(
      (ids ?? "")
        .split(/\s+/)
        .map((id) => (id ? root.getElementById(id)?.textContent : ""))
        .join(" "),
    );

  const isField = el.matches(
    "input, select, textarea, [contenteditable='true'], [contenteditable=''], [role=textbox], [role=searchbox], [role=combobox], [role=checkbox], [role=radio], [role=switch], [role=slider], [role=spinbutton]",
  );
  const labels = (el as HTMLInputElement).labels;
  const fieldLabel = isField
    ? clip(
        textById(el.getAttribute("aria-labelledby")) ||
          squash(labels?.[0]?.textContent) ||
          squash(el.closest("label")?.textContent),
        80,
      ) || null
    : null;

  let contains: BrowserPickedDetails["contains"] = null;
  if (!accessibleName) {
    const seen = new Set<string>();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (
      let visited = 0, node = walker.nextNode();
      node && visited < 2000;
      node = walker.nextNode()
    ) {
      visited += 1;
      const text = clip(squash(node.textContent), 30);
      if (!text || seen.has(text)) continue;
      if (node.parentElement?.checkVisibility?.() === false) continue;
      seen.add(text);
    }
    const texts = Array.from(seen);
    if (texts.length > 0)
      contains = { texts: texts.slice(0, 3), more: Math.max(0, texts.length - 3) };
  }

  const LANDMARK_TAGS: Record<string, string> = {
    main: "main",
    nav: "nav",
    aside: "aside",
    form: "form",
    article: "article",
    section: "section",
    dialog: "dialog",
    header: "header",
    footer: "footer",
    search: "search",
  };
  const LANDMARK_ROLES = new Set(
    "main navigation complementary form article region dialog alertdialog banner contentinfo search tabpanel".split(
      " ",
    ),
  );
  const context: Array<{ role: string; name: string }> = [];
  for (let node = el.parentElement; node && context.length < 4; node = node.parentElement) {
    const explicit = node.getAttribute("role")?.split(" ")[0] ?? "";
    const role = LANDMARK_ROLES.has(explicit) ? explicit : LANDMARK_TAGS[node.localName];
    if (!role) continue;
    const name = clip(
      squash(node.getAttribute("aria-label")) ||
        textById(node.getAttribute("aria-labelledby")) ||
        (/^(?:section|region|article|dialog|alertdialog)$/.test(role)
          ? squash(node.querySelector("h1, h2, h3, h4, h5, h6, [role=heading]")?.textContent)
          : ""),
      40,
    );
    if ((role === "section" || role === "region") && !name) continue;
    context.unshift({ role, name });
  }
  if (context.length === 0) {
    const headings = select("h1, h2, h3, h4, h5, h6") ?? [];
    for (let index = headings.length - 1; index >= 0; index -= 1) {
      const heading = headings[index]!;
      if (heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
        const name = clip(squash(heading.textContent), 40);
        if (name) context.push({ role: "heading", name });
        break;
      }
    }
  }

  // Same role and name, approximated by tag (or role attribute) plus aria-label or text; same
  // tag and text for elements without a name. Skipped on very large candidate sets.
  let rank: BrowserPickedDetails["rank"] = null;
  const ownText = clip(squash(el.textContent), 200);
  const key = accessibleName || ownText;
  if (key) {
    const role = el.getAttribute("role");
    const firstClass = Array.from(el.classList).find(semantic);
    const pool = select(
      role && /^[\w-]+$/.test(role)
        ? `[role="${role}"]`
        : `${CSS.escape(el.localName)}${!accessibleName && firstClass ? `.${CSS.escape(firstClass)}` : ""}`,
    );
    if (pool && pool.length > 1 && pool.length <= 1500) {
      const keyOf = (node: Element) => {
        const text = clip(squash(node.textContent), 200);
        return accessibleName ? clip(squash(node.getAttribute("aria-label")) || text, 80) : text;
      };
      let index = 0;
      let total = 0;
      for (const node of Array.from(pool)) {
        if (keyOf(node) !== key) continue;
        total += 1;
        if (node === el) index = total;
      }
      if (index > 0 && total > 1) rank = { index, total };
    }
  }

  const computed = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  const style = [`${Math.round(box.width)}×${Math.round(box.height)}`];
  const sides = ["top", "right", "bottom", "left"].map((side) =>
    computed.getPropertyValue(`padding-${side}`),
  );
  if (!sides.every((value) => value === "0px")) {
    const [top, right, bottom, left] = sides;
    style.push(
      `padding ${sides.every((value) => value === top) ? top : top === bottom && right === left ? `${top} ${right}` : sides.join(" ")}`,
    );
  }
  if (computed.fontSize !== "16px" || computed.fontWeight !== "400")
    style.push(`${computed.fontSize}/${computed.fontWeight}`);
  const hex = (value: string) => {
    const match = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)$/.exec(value);
    if (!match) return value;
    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    if (alpha === 0) return "";
    const channels = [match[1], match[2], match[3]].map((n) =>
      Math.round(Number(n)).toString(16).padStart(2, "0"),
    );
    const short = channels.every((c) => c[0] === c[1]);
    const color = `#${channels.map((c) => (short ? c[0] : c)).join("")}`;
    return alpha < 1 ? `${color} ${Math.round(alpha * 100)}%` : color;
  };
  const color = hex(computed.color);
  const background = hex(computed.backgroundColor);
  const showColor = color && color !== "#000";
  if (showColor && background) style.push(`${color} on ${background}`);
  else if (background) style.push(`bg ${background}`);
  else if (showColor) style.push(`color ${color}`);
  if (computed.borderRadius !== "0px") style.push(`radius ${computed.borderRadius}`);
  if (computed.boxShadow !== "none") style.push("shadow");

  return {
    selector: findSelector(),
    fieldLabel,
    contains,
    context,
    rank,
    style: style.join(" · "),
  };
}

// Reads the picked element in the picker's isolated world, so page scripts cannot see or patch
// the call. Nodes in a same-process child frame only resolve in their own frame's main world.
export async function readPickDetails(
  cdp: CdpSession,
  backendNodeId: number,
  isolatedWorld: number | null,
  accessibleName: string,
): Promise<BrowserPickedDetails> {
  const resolve = (params: object) =>
    cdp.send<{ object: { objectId: string } }>("DOM.resolveNode", { backendNodeId, ...params });
  const { object } = await (isolatedWorld === null
    ? resolve({})
    : resolve({ executionContextId: isolatedWorld }).catch(() => resolve({})));
  try {
    const { result, exceptionDetails } = await cdp.send<{
      result: { value?: BrowserPickedDetails };
      exceptionDetails?: { text?: string };
    }>("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: `function (name) { return (${readDetails.toString()})(this, name); }`,
      arguments: [{ value: accessibleName }],
      returnByValue: true,
    });
    if (exceptionDetails || !result.value) {
      throw new Error(`Could not read the element: ${exceptionDetails?.text ?? "no result"}`);
    }
    return result.value;
  } finally {
    void cdp.send("Runtime.releaseObject", { objectId: object.objectId }).catch(() => {});
  }
}
