import type { BrowserFindInput } from "@glade/contracts/browser/browserTools";
import * as Vm from "node:vm";
import { BrowserFailure } from "../../browserFailure";
import type { CdpSession } from "../cdpSession";
import type { RefTable } from "../refs";
import { collectTree, type CollectedTree, type SnapshotNode } from "./collectTree";
import { scoreCandidates, type FindCandidate } from "./findQuery";
import { renderMatches, type SnapshotMatch } from "./snapshotFormat";

const FIND_MAX_MATCHES = 20;
const REGEX_TIMEOUT_MS = 250;
const MAX_SCROLLERS_NOTED = 3;
// A find match inside one of these carries the whole row's or item's text.
const ROW_ROLES = new Set(["row", "listitem", "article", "treeitem", "option"]);

// What a row or item shows: text, and names of elements whose text was folded into their name
// (table cells, links).
const shownText = (nodes: readonly SnapshotNode[]): string =>
  nodes
    .map((node) =>
      node.role === "text"
        ? node.name
        : [node.name, shownText(node.children)].filter(Boolean).join(" "),
    )
    .filter(Boolean)
    .join(" · ")
    .replace(/\s+/gu, " ")
    .trim();

// Why nothing matched may be content that has not loaded yet; say where the page and its scroll
// containers stand.
function noMatchNote(
  tree: CollectedTree,
  loading: boolean,
  scrollers: readonly { readonly label: string; readonly scrolled: string }[],
): string {
  if (loading) return "No elements matched. The page is still loading; search again in a moment.";
  const notes = ["No elements matched."];
  if (tree.viewport) {
    const { y, height, contentHeight } = tree.viewport;
    const below = Math.round(((contentHeight - y - height) / height) * 10) / 10;
    if (below >= 0.5) {
      notes.push(
        `The loaded page continues ${below} screens below the viewport; content that loads as you scroll appears after browser_scroll.`,
      );
    }
  }
  if (scrollers.length > 0) {
    const list = scrollers.map(({ label, scrolled }) => `${label} (${scrolled})`).join(", ");
    notes.push(
      `Scroll containers show only part of their content: ${list}; browser_scroll with that ref shows more.`,
    );
  }
  notes.push("browser_snapshot shows what is on the page.");
  return notes.join(" ");
}

function regexScores(query: string, texts: readonly string[]): number[] {
  let pattern: RegExp;
  try {
    pattern = new RegExp(query, "imu");
  } catch (error) {
    throw new BrowserFailure("invalid_input", `Invalid regex: ${(error as Error).message}`);
  }
  // A model-supplied pattern could backtrack forever; the vm timeout interrupts it so it cannot
  // stall the desktop main process.
  try {
    return Vm.runInNewContext(
      "texts.map((text) => (pattern.test(text) ? 1 : 0))",
      { texts, pattern },
      { timeout: REGEX_TIMEOUT_MS },
    ) as number[];
  } catch {
    throw new BrowserFailure("invalid_input", "The regex took too long; use a simpler pattern.");
  }
}

interface Entry {
  readonly node: SnapshotNode;
  readonly ancestors: readonly SnapshotNode[];
  readonly candidate: FindCandidate;
}

export async function findElements(
  cdp: CdpSession,
  refs: RefTable,
  input: typeof BrowserFindInput.Type,
  loading: boolean,
): Promise<string> {
  const collected = await collectTree(cdp, refs, null);
  const entries: Entry[] = [];
  const scrollers: { label: string; scrolled: string }[] = [];
  const rowTexts = new Map<SnapshotNode, string>();
  const rowText = (row: SnapshotNode) => {
    let text = rowTexts.get(row);
    if (text === undefined) {
      text = shownText(row.children) || row.name;
      rowTexts.set(row, text);
    }
    return text;
  };
  const walk = (node: SnapshotNode, ancestors: SnapshotNode[]) => {
    // Text is scored as part of the element it belongs to.
    const owner = node.role === "text" ? ancestors.findLast((a) => a.ref !== undefined) : node;
    const row = ancestors.findLast((ancestor) => ROW_ROLES.has(ancestor.role));
    const candidate = {
      role: owner?.role ?? node.role,
      name: node.name,
      value: node.value,
      description: node.description,
      interactive: owner?.interactive ?? false,
      context: row ? rowText(row) : undefined,
    };
    entries.push({ node, ancestors, candidate });
    const scrolled = node.states.find((state) => state.includes("% scrolled"));
    if (scrolled && node.ref && scrollers.length < MAX_SCROLLERS_NOTED) {
      scrollers.push({ label: refs.describe(node.ref), scrolled });
    }
    for (const child of node.children) walk(child, [...ancestors, node]);
  };
  for (const root of collected.roots) walk(root, []);
  const { scores, byRoleOnly } = input.regex
    ? {
        scores: regexScores(
          input.query,
          // Role, name and value on separate lines so ^ and $ anchor to each field.
          entries.map(
            ({ node }) => `${node.role}\n${node.name.trim()}\n${node.value?.trim() ?? ""}`,
          ),
        ),
        byRoleOnly: false,
      }
    : scoreCandidates(
        input.query,
        entries.map((entry) => entry.candidate),
      );
  const ranked = entries
    .map((entry, index) => ({ entry, score: scores[index]!, index }))
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score || a.index - b.index);
  const seen = new Set<string>();
  const matches: SnapshotMatch[] = [];
  for (const { entry } of ranked) {
    // Text has no ref; the nearest element that does is what the model can act on. Text in
    // no listed control (a hover menu's plain trigger) gets a ref for its own element instead.
    const chain = [...entry.ancestors, entry.node];
    const targetIndex = chain.findLastIndex((node) => node.ref !== undefined);
    const listed = chain[targetIndex];
    let target = listed;
    const owner = listed?.interactive ? undefined : entry.node.owner;
    if (owner && refs.refFor(owner) !== listed?.ref) {
      target = { ...entry.node, ref: refs.refFor(owner, { role: "text", name: entry.node.name }) };
    }
    if (!target?.ref || seen.has(target.ref)) continue;
    seen.add(target.ref);
    const context = chain.slice(0, targetIndex).findLast((node) => node.name.length > 0);
    // Matched text inside an element is what the model searched for; show it.
    const text = entry.node.role === "text" && target.role !== "text" ? entry.node.name : undefined;
    const container = chain.findLast((node) => ROW_ROLES.has(node.role) && node !== target);
    const containerText = container ? rowText(container) : "";
    const row =
      containerText && containerText !== target.name
        ? { role: container!.role, text: containerText }
        : undefined;
    const offscreenIn = target.clippedBy ? refs.describe(target.clippedBy) : undefined;
    matches.push({ node: target, context, text, row, offscreenIn });
  }
  if (matches.length === 0) return noMatchNote(collected, loading, scrollers);
  // What the model can see right now comes first; rows a scroll container hides follow.
  const shown = matches.toSorted(
    (a, b) => Number(a.offscreenIn !== undefined) - Number(b.offscreenIn !== undefined),
  );
  const list = renderMatches(shown.slice(0, FIND_MAX_MATCHES), matches.length);
  return byRoleOnly
    ? `No element matched those words; these have the role you named:\n${list}`
    : list;
}
