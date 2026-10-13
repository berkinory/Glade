import { createContext, memo, Suspense, use, useContext, useMemo, type ReactElement } from "react";
import renderMarkdownTree, { defaultUrlTransform, type Options } from "react-markdown";
import type { Root } from "mdast";

import { LRUCache } from "../lib/lruCache";
import { rewriteMarkdownFileUriHref } from "../markdown-links";
import type {
  MarkdownBlock as MarkdownBlockSource,
  MarkdownBlockSplitter,
} from "../markdownIncremental";
import { rehypeBlockDirection } from "./ChatMarkdownDirection";
import { remarkFindableText } from "./ChatMarkdownFind";
import { restoreLiteralDollarPlaceholders } from "./markdownDollarProtection";

type MarkdownRemarkPlugins = NonNullable<Options["remarkPlugins"]>;
type MarkdownRehypePlugins = NonNullable<Options["rehypePlugins"]>;

export interface MarkdownPipeline {
  // Identifies everything besides the block itself that shapes the rendered tree.
  cacheKey: string;
  // Plugins that read `file.value` see block-relative positions; document positions are applied
  // after them.
  remarkPlugins: MarkdownRemarkPlugins;
  components: NonNullable<Options["components"]>;
  rehype: "user" | "assistant" | "authored-html";
}

function markdownUrlTransform(href: string): string {
  const restoredHref = restoreLiteralDollarPlaceholders(href);
  return rewriteMarkdownFileUriHref(restoredHref) ?? defaultUrlTransform(restoredHref);
}

function restoreLiteralDollarsInNode(node: unknown): void {
  if (!node || typeof node !== "object") {
    return;
  }
  if ("type" in node && node.type === "text" && "value" in node && typeof node.value === "string") {
    node.value = restoreLiteralDollarPlaceholders(node.value);
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      restoreLiteralDollarsInNode(child);
    }
  }
}

function rehypeRestoreLiteralDollars() {
  return (tree: unknown) => {
    restoreLiteralDollarsInNode(tree);
  };
}

const BASE_MARKDOWN_REHYPE_PLUGINS: MarkdownRehypePlugins = [
  rehypeRestoreLiteralDollars,
  rehypeBlockDirection,
];
const USER_MARKDOWN_REHYPE_PLUGINS: MarkdownRehypePlugins = [rehypeBlockDirection];

// KaTeX and the authored-HTML sanitizer are heavy and rarely needed, so they load on first use. Once
// loaded, a combination is read synchronously, so only the first message that needs it waits. The
// sanitizer runs first, directly after parsing, and KaTeX after it so its generated markup does not
// widen the allowlist.
const extendedRehypePluginsByKey = new Map<string, MarkdownRehypePlugins>();
const extendedRehypePluginsPromiseByKey = new Map<string, Promise<MarkdownRehypePlugins>>();
function loadExtendedRehypePlugins(
  key: string,
  authoredHtml: boolean,
  math: boolean,
): Promise<MarkdownRehypePlugins> {
  let promise = extendedRehypePluginsPromiseByKey.get(key);
  if (!promise) {
    promise = Promise.all([
      authoredHtml ? import("./ChatMarkdownHtml") : null,
      math ? import("./ChatMarkdownMath") : null,
    ]).then(([htmlModule, mathModule]) => {
      const plugins: MarkdownRehypePlugins = [
        ...(htmlModule?.AUTHORED_HTML_REHYPE_PLUGINS ?? []),
        ...(mathModule?.MATH_REHYPE_PLUGINS ?? []),
        ...BASE_MARKDOWN_REHYPE_PLUGINS,
      ];
      extendedRehypePluginsByKey.set(key, plugins);
      return plugins;
    });
    extendedRehypePluginsPromiseByKey.set(key, promise);
  }
  return promise;
}

interface PositionedNode {
  position?: {
    start: { line: number; column: number; offset?: number | undefined };
    end: { line: number; column: number; offset?: number | undefined };
  };
  children?: PositionedNode[];
}

// Transforms share point objects between neighbouring nodes, so each position is replaced rather
// than shifted in place.
function shiftPositions(node: PositionedNode, block: MarkdownBlockSource): void {
  const position = node.position;
  if (position) {
    const shift = (point: (typeof position)["start"]) => ({
      ...point,
      line: point.line + block.line,
      ...(point.offset === undefined ? {} : { offset: point.offset + block.offset }),
    });
    node.position = { start: shift(position.start), end: shift(position.end) };
  }
  for (const child of node.children ?? []) shiftPositions(child, block);
}

function remarkDocumentPositions(block: MarkdownBlockSource) {
  return (tree: Root) => shiftPositions(tree as PositionedNode, block);
}

// A whole document separates top-level elements with a newline text node; a later block supplies
// the one before its first element.
function rehypeBlockSeparator() {
  return (tree: { children: unknown[] }) => {
    if (tree.children.length > 0) tree.children.unshift({ type: "text", value: "\n" });
  };
}

// Rendered trees hold their hast nodes, measured at roughly 20-40 bytes per source character. A
// block too large to share the budget with a few threads is not cached.
const RENDERED_BLOCK_BYTES_PER_SOURCE_CHAR = 40;
const MAX_CACHED_BLOCK_CHARS = 100_000;
const renderedBlockCache = new LRUCache<ReactElement>(400, 16 * 1024 * 1024);

interface MarkdownBlockRender {
  block: MarkdownBlockSource;
  pipeline: MarkdownPipeline;
  observedBy: MarkdownBlockSplitter | undefined;
  cacheable: boolean;
}

// Each rendered tree is a pure function of the cache key: components read their context when they
// render, not when the tree is built.
function renderBlockTree(
  { block, pipeline, observedBy, cacheable }: MarkdownBlockRender,
  rehypeKey: string,
  rehypePlugins: MarkdownRehypePlugins,
): ReactElement {
  const cacheKey =
    cacheable && block.source.length <= MAX_CACHED_BLOCK_CHARS
      ? `${pipeline.cacheKey}\n${rehypeKey}\n${block.offset}:${block.line}\n${block.source}`
      : null;
  const cached = cacheKey === null ? null : renderedBlockCache.get(cacheKey);
  if (cached) return cached;
  const isLaterBlock = block.offset > 0;
  const remarkPlugins: MarkdownRemarkPlugins = [...pipeline.remarkPlugins];
  if (observedBy) remarkPlugins.unshift([observedBy.observeTail, block]);
  if (isLaterBlock) remarkPlugins.push([remarkDocumentPositions, block]);
  remarkPlugins.push(remarkFindableText);
  const tree = renderMarkdownTree({
    children: block.source,
    remarkPlugins,
    rehypePlugins: isLaterBlock ? [...rehypePlugins, rehypeBlockSeparator] : rehypePlugins,
    components: pipeline.components,
    urlTransform: markdownUrlTransform,
  });
  if (cacheKey !== null) {
    renderedBlockCache.set(
      cacheKey,
      tree,
      block.source.length * RENDERED_BLOCK_BYTES_PER_SOURCE_CHAR,
    );
  }
  return tree;
}

function BlockTree(props: {
  render: MarkdownBlockRender;
  rehypeKey: string;
  rehypePlugins: MarkdownRehypePlugins;
}) {
  return renderBlockTree(props.render, props.rehypeKey, props.rehypePlugins);
}

function ExtendedBlockTree(props: {
  render: MarkdownBlockRender;
  math: boolean;
  authoredHtml: boolean;
}) {
  const { render, math, authoredHtml } = props;
  const key = `${authoredHtml ? "html" : ""}:${math ? "math" : ""}`;
  // A single `use` call: React replays suspended `use` calls by position.
  const rehypePlugins =
    !authoredHtml && !math
      ? BASE_MARKDOWN_REHYPE_PLUGINS
      : (extendedRehypePluginsByKey.get(key) ??
        use(loadExtendedRehypePlugins(key, authoredHtml, math)));
  return renderBlockTree(render, key, rehypePlugins);
}

interface MarkdownSourceLocation {
  text: string;
  offset: number;
}

const MarkdownSourceContext = createContext<MarkdownSourceLocation | null>(null);

// Locates rendered text, such as a code block's dedented body, in the unprotected message source
// at or after a node's start, so find highlights land on the source offsets.
export function useMarkdownSourceLocator(): (text: string, fromOffset: number) => number {
  const location = useContext(MarkdownSourceContext);
  return (text, fromOffset) => {
    if (!location) return fromOffset;
    const index = location.text.indexOf(text, fromOffset - location.offset);
    return index < 0 ? fromOffset : index + location.offset;
  };
}

interface MarkdownBlockProps {
  source: string;
  offset: number;
  line: number;
  // The same span of the message before literal dollars were protected.
  rawSource: string;
  pipeline: MarkdownPipeline;
  // Set on the open tail of a streaming message to discover its next block boundaries.
  observedBy: MarkdownBlockSplitter | undefined;
  cacheable: boolean;
}

// Memoized by its slice so a closed block never re-parses while the tail grows; parsing and
// rendering a block costs milliseconds per few KiB.
export const MarkdownBlock = memo(function MarkdownBlock({
  source,
  offset,
  line,
  rawSource,
  pipeline,
  observedBy,
  cacheable,
}: MarkdownBlockProps) {
  const render: MarkdownBlockRender = {
    block: { source, offset, line },
    pipeline,
    observedBy,
    cacheable,
  };
  const sourceLocation = useMemo(() => ({ text: rawSource, offset }), [rawSource, offset]);
  return (
    <MarkdownSourceContext value={sourceLocation}>
      {pipeline.rehype === "user" ? (
        <BlockTree render={render} rehypeKey="user" rehypePlugins={USER_MARKDOWN_REHYPE_PLUGINS} />
      ) : (
        // Until a plugin module loads, the base plugins render math as its TeX source and drop
        // authored HTML, so unsanitized markup never reaches the DOM.
        <Suspense
          fallback={
            <BlockTree render={render} rehypeKey=":" rehypePlugins={BASE_MARKDOWN_REHYPE_PLUGINS} />
          }
        >
          <ExtendedBlockTree
            render={render}
            math={source.includes("$")}
            authoredHtml={pipeline.rehype === "authored-html"}
          />
        </Suspense>
      )}
    </MarkdownSourceContext>
  );
});
