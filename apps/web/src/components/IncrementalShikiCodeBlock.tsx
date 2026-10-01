import { toHtml } from "hast-util-to-html";
import type { DiffsHighlighter } from "@pierre/diffs";
import {
  createElement,
  Fragment,
  memo,
  use,
  useEffect,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";

import { createIncrementalHighlightedDocument } from "../lib/incrementalHighlighting";
import type { DiffThemeName } from "../lib/diffRendering";
import type * as SyntaxHighlighting from "../lib/syntaxHighlighting";
import { useFindTextRenderer } from "./ChatMarkdownFind";

type HighlightedRoot = ReturnType<DiffsHighlighter["codeToHast"]>;
type HighlightedNode = HighlightedRoot["children"][number];

function textLength(node: HighlightedNode): number {
  if (node.type === "text") return node.value.length;
  return "children" in node
    ? node.children.reduce((size, child) => size + textLength(child), 0)
    : 0;
}

function styleProperties(value: unknown): CSSProperties | undefined {
  if (typeof value !== "string") return undefined;
  return Object.fromEntries(
    value.split(";").flatMap((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator < 0) return [];
      const property = declaration.slice(0, separator).trim();
      const name = property.replace(/-([a-z])/g, (_, character: string) => character.toUpperCase());
      return [[name, declaration.slice(separator + 1).trim()]];
    }),
  );
}

function renderHighlightedNode(
  node: HighlightedNode,
  sourceOffset: number,
  renderText: (text: string, offset: number) => ReactNode,
): ReactNode {
  if (node.type === "text") return renderText(node.value, sourceOffset);
  if (node.type !== "element") return null;
  let offset = sourceOffset;
  const children = node.children.map((child, index) => {
    const content = renderHighlightedNode(child, offset, renderText);
    offset += textLength(child);
    return <Fragment key={index}>{content}</Fragment>;
  });
  return createElement(
    node.tagName,
    { className: node.properties.class, style: styleProperties(node.properties.style) },
    children,
  );
}

// Completed HAST lines retain their identity in the external TextMate cache.
const HighlightedLine = memo(function HighlightedLine({
  node,
  sourceOffset,
}: {
  node: HighlightedNode;
  sourceOffset: number;
}) {
  const renderText = useFindTextRenderer();
  return renderHighlightedNode(node, sourceOffset, renderText);
});

export function IncrementalShikiCodeBlock(props: {
  syntaxHighlighting: typeof SyntaxHighlighting;
  language: string;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
  sourceOffset: number;
}) {
  const { syntaxHighlighting, language, code, themeName, isStreaming, sourceOffset } = props;
  const highlighter = use(syntaxHighlighting.getSyntaxHighlighterPromise(language));
  // The TextMate continuation owns state outside React; restarting it discards the tokenized prefix.
  const highlight = useMemo(
    () => createIncrementalHighlightedDocument(highlighter, language, themeName),
    [highlighter, language, themeName],
  );
  const root = highlight(code);
  const pre = root.children.find((node) => node.type === "element" && node.tagName === "pre");
  const codeNode =
    pre?.type === "element"
      ? pre.children.find((node) => node.type === "element" && node.tagName === "code")
      : undefined;
  if (pre?.type !== "element" || codeNode?.type !== "element") {
    throw new Error("Missing highlighted code elements");
  }
  useEffect(() => {
    if (isStreaming) return;
    const cacheKey = syntaxHighlighting.createSyntaxHighlightCacheKey(code, language, themeName);
    if (syntaxHighlighting.getCachedSyntaxHighlightedHtml(cacheKey) !== null) return;
    const html = toHtml(root);
    syntaxHighlighting.cacheSyntaxHighlightedHtml(cacheKey, html, code);
  }, [syntaxHighlighting, root, code, language, themeName, isStreaming]);
  let offset = sourceOffset;
  return (
    <div className="chat-markdown-shiki">
      <pre
        className={String(pre.properties.class ?? "shiki")}
        style={styleProperties(pre.properties.style)}
        tabIndex={0}
      >
        <code>
          {codeNode.children.map((node, index) => {
            const line = <HighlightedLine key={index} node={node} sourceOffset={offset} />;
            offset += textLength(node);
            return line;
          })}
        </code>
      </pre>
    </div>
  );
}
