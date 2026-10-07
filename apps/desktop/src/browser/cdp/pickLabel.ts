import type { CdpSession } from "./cdpSession";

export type PickNode = { readonly nodeId: number } | { readonly backendNodeId: number };

export interface PickTarget {
  // The accessible role when it says something, otherwise the tag name.
  readonly role: string;
  readonly name: string;
  // `button "Save"` or `div.pricing-card`; the hover label adds the size.
  readonly label: string;
}

interface AxNode {
  readonly ignored?: boolean;
  readonly role?: { readonly value?: unknown };
  readonly name?: { readonly value?: unknown };
}

// Roles Chromium gives to elements that carry no meaning of their own.
const VAGUE_ROLES = new Set([
  "",
  "none",
  "generic",
  "presentation",
  "GenericContainer",
  "StaticText",
  "InlineTextBox",
  "LineBreak",
  "paragraph",
  "RootWebArea",
]);
const MAX_LABEL = 64;
const MAX_NAME = 80;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

// `tag#id` or `tag.class1.class2`. Only identifier-like tokens are kept, so the label can stay
// unquoted in what the agent reads without carrying page text.
function tagLabel(tag: string, attributes: readonly string[]): string {
  const read = (key: string) => {
    for (let index = 0; index + 1 < attributes.length; index += 2) {
      if (attributes[index] === key) return attributes[index + 1]!.trim();
    }
    return "";
  };
  const safe = (token: string) => /^[\w-]{1,40}$/u.test(token);
  const id = read("id");
  if (safe(id)) return `${tag}#${id}`;
  const classes = read("class").split(/\s+/u).filter(safe).slice(0, 2);
  return clip(`${tag}${classes.map((name) => `.${name}`).join("")}`, MAX_LABEL);
}

export async function readPickTarget(cdp: CdpSession, node: PickNode): Promise<PickTarget> {
  const [ax, dom] = await Promise.all([
    cdp.send<{ nodes: readonly AxNode[] }>("Accessibility.getPartialAXTree", {
      ...node,
      fetchRelatives: false,
    }),
    cdp.send<{ node: { localName?: string; nodeName: string; attributes?: readonly string[] } }>(
      "DOM.describeNode",
      { ...node, depth: 0 },
    ),
  ]);
  const axNode = ax.nodes.find((candidate) => !candidate.ignored) ?? ax.nodes[0];
  const axRole = String(axNode?.role?.value ?? "");
  const axName = String(axNode?.name?.value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  const tag = (dom.node.localName || dom.node.nodeName).toLowerCase().replace(/[^\w-]/gu, "");
  if (!VAGUE_ROLES.has(axRole) && axName) {
    const name = clip(axName, MAX_NAME);
    return { role: axRole, name, label: `${axRole} ${JSON.stringify(name)}` };
  }
  return { role: tag, name: "", label: tagLabel(tag, dom.node.attributes ?? []) };
}
