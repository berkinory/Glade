import React, { useMemo, type ReactNode } from "react";

import {
  collectCaseInsensitiveSubstringRanges,
  normalizeFindQuery,
  splitTextWithFindMatches,
  splitTextWithFindRanges,
  wrapFindQueryInHtml,
  type ThreadFindRange,
} from "./chat/threadFind.logic";

type MarkdownTextNode = {
  type: "text";
  value: string;
  position?: {
    start?: {
      offset?: number;
    };
    end?: {
      offset?: number;
    };
  };
};
type MarkdownParentNode = {
  type?: string;
  children?: MarkdownNode[];
};
type MarkdownNode = MarkdownTextNode | MarkdownParentNode | Record<string, unknown>;
export const CHAT_FIND_TEXT_TAG_NAME = "chat-find-text";
export const CHAT_FIND_TEXT_START_ATTRIBUTE = "data-chat-find-text-start";
export function remarkFindableText() {
  return (tree: MarkdownNode) => wrapFindableTextNodes(tree);
}
function wrapFindableTextNodes(node: MarkdownNode): void {
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children)) {
    return;
  }
  const parent = node as MarkdownParentNode;
  parent.children = (parent.children ?? []).map((child) => {
    if (child && typeof child === "object" && "type" in child && child.type === "text") {
      return wrapFindableTextNode(child as MarkdownTextNode);
    }
    wrapFindableTextNodes(child);
    return child;
  });
}
function wrapFindableTextNode(node: MarkdownTextNode): MarkdownNode {
  const startOffset = node.position?.start?.offset;
  if (startOffset === undefined || node.value.length === 0) {
    return node;
  }
  return {
    type: "chatFindText",
    data: {
      hName: CHAT_FIND_TEXT_TAG_NAME,
      hProperties: {
        [CHAT_FIND_TEXT_START_ATTRIBUTE]: String(startOffset),
      },
    },
    children: [node],
  };
}

interface ChatFindRenderState {
  query: string;
  ranges: readonly ThreadFindRange[];
  activeRange: ThreadFindRange | null;
}

const EMPTY_CHAT_FIND_RENDER_STATE: ChatFindRenderState = {
  query: "",
  ranges: [],
  activeRange: null,
};

const ChatFindRenderContext = React.createContext<ChatFindRenderState>(
  EMPTY_CHAT_FIND_RENDER_STATE,
);

export function ChatFindRenderProvider(props: {
  query: string;
  sourceText: string;
  activeRange: ThreadFindRange | null;
  children: ReactNode;
}) {
  const ranges = useMemo(
    () =>
      normalizeFindQuery(props.query).length === 0
        ? EMPTY_CHAT_FIND_RENDER_STATE.ranges
        : collectCaseInsensitiveSubstringRanges(props.sourceText, props.query),
    [props.query, props.sourceText],
  );
  const value = useMemo<ChatFindRenderState>(
    () => ({ query: props.query, ranges, activeRange: props.activeRange }),
    [props.activeRange, props.query, ranges],
  );
  return (
    <ChatFindRenderContext.Provider value={value}>{props.children}</ChatFindRenderContext.Provider>
  );
}

function findMatchClassName(part: {
  active: boolean;
  continuesBefore?: boolean;
  continuesAfter?: boolean;
}): string {
  return [
    "chat-find-match",
    part.active ? "chat-find-match-active" : "",
    part.continuesBefore ? "chat-find-match-continues-before" : "",
    part.continuesAfter ? "chat-find-match-continues-after" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function renderFindTextParts(parts: ReturnType<typeof splitTextWithFindMatches>): ReactNode {
  if (parts.length === 1 && !parts[0]!.match) {
    return parts[0]!.text;
  }
  return parts.map((part, index) =>
    part.match ? (
      <span
        key={`${part.startOffset ?? index}:${index}`}
        className={findMatchClassName(part)}
        data-chat-find-match={part.active ? "active" : "true"}
        data-chat-find-start={part.startOffset}
      >
        {part.text}
      </span>
    ) : (
      <span key={`text:${index}`}>{part.text}</span>
    ),
  );
}

function renderFindWrappedText(
  text: string,
  query: string,
  activeRange: ThreadFindRange | null,
  sourceOffset: number,
): ReactNode {
  return renderFindTextParts(splitTextWithFindMatches(text, query, activeRange, sourceOffset));
}

export function useFindTextRenderer() {
  const highlight = React.useContext(ChatFindRenderContext);
  return (text: string, sourceOffset: number) =>
    renderFindTextParts(
      splitTextWithFindRanges(text, highlight.ranges, highlight.activeRange, sourceOffset),
    );
}

export function FindAwareMarkdownText(props: { text: string; sourceOffset: number }) {
  const renderText = useFindTextRenderer();
  return renderText(props.text, props.sourceOffset);
}

export function FindAwareCodeFallback(props: {
  children: ReactNode;
  code: string;
  sourceOffset: number;
}) {
  const highlight = React.useContext(ChatFindRenderContext);
  if (normalizeFindQuery(highlight.query).length === 0) {
    return props.children;
  }
  return (
    <code>
      {renderFindWrappedText(
        props.code,
        highlight.query,
        highlight.activeRange,
        props.sourceOffset,
      )}
    </code>
  );
}

export function FindAwareShikiHtml(props: { html: string; sourceOffset: number }) {
  const highlight = React.useContext(ChatFindRenderContext);
  const html =
    normalizeFindQuery(highlight.query).length > 0
      ? wrapFindQueryInHtml(props.html, highlight.query, props.sourceOffset, highlight.activeRange)
      : props.html;
  return <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: html }} />;
}
