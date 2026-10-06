import type { IconComponent } from "~/lib/iconComponent";
import {
  CheckIcon,
  Copy01Icon,
  InfoIcon,
  LightbulbIcon,
  OctagonAlertIcon,
  TextWrapIcon,
  TriangleAlertIcon,
} from "~/lib/icons";
import type { ProviderMentionReference } from "@glade/contracts/provider/providerDiscovery";
import "katex/dist/katex.min.css";
import { remarkWikiLinks } from "../lib/remarkWikiLinks";
import {
  MARKDOWN_LINK_POSITION_SUFFIX_PATTERN,
  OpenableFileChip,
  VerifiedWorkspaceFileChip,
} from "./MarkdownWorkspaceFileChip";
import {
  protectLiteralMarkdownDollars,
  restoreLiteralDollarPlaceholders,
} from "./markdownDollarProtection";
import { remarkGithubAlerts, type GithubAlertKind } from "../lib/remarkGithubAlerts";
import React, {
  Children,
  createContext,
  useContext,
  type CSSProperties,
  Suspense,
  isValidElement,
  memo,
  use,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { copyTextToClipboard } from "../lib/clipboard";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";
import { dedentCode, parseCodeFenceInfo, type CodeFenceInfo } from "../lib/codeFence";
import { pathLooksLikeKnownFile } from "../file-icons";
import { FileEntryIcon } from "./chat/FileEntryIcon";
import { isLocalImageMarkdownSrc } from "../lib/localImageUrls";
import { repairMarkdownTableDelimiters } from "../lib/markdownTableRepair";
import { useTheme } from "../hooks/useTheme";
import { useSmoothStreamedText } from "../hooks/useSmoothStreamedText";
import { useThrottledStreamingValue } from "../hooks/useThrottledStreamingValue";
import {
  extractAbsoluteFilesystemPaths,
  resolveChatFileChipTarget,
  resolveMarkdownFileLinkTarget,
  rewriteMarkdownFileUriHref,
} from "../markdown-links";
import type { ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { MarkdownChatLink, markdownChatLinkId } from "./chat/MarkdownChatLink";
import { GeneratedMarkdownImage } from "./chat/GeneratedMarkdownImage";
import { TerminalContextInlineChip } from "./chat/TerminalContextInlineChip";
import type { ParsedTerminalContextEntry } from "../lib/terminalContext";
import { formatInlineTerminalContextLabel } from "./chat/userMessageTerminalContexts";
import {
  COMPOSER_INLINE_CHIP_ICON_LABEL_GAP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_TOKEN_ICON_CLASS_NAME,
} from "./composerInlineChip";
import { LinkChipIcon } from "./LinkChipIcon";
import { InlineAgentChip } from "./chat/InlineAgentChip";
import { InlineLinkChip } from "./InlineLinkChip";
import { InlineMentionChip } from "./chat/InlineMentionChip";
import { InlineSkillChip } from "./chat/InlineSkillChip";
import { InlineSlashCommandChip } from "./chat/InlineSlashCommandChip";
import {
  COMPOSER_CHIP_SEGMENT_ATTRIBUTE,
  COMPOSER_CHIP_TAG_NAME,
  TERMINAL_CONTEXT_CHIP_INDEX_ATTRIBUTE,
  TERMINAL_CONTEXT_CHIP_TAG_NAME,
  createComposerChipsRemarkPlugin,
  parseComposerChipSegment,
} from "../lib/remarkComposerChips";
import { IconButton } from "./ui/icon-button";
import { applyActiveChatFindMatch, type ThreadFindRange } from "./chat/threadFind.logic";
import {
  ChatFindRenderProvider,
  FindAwareCodeFallback,
  FindAwareMarkdownText,
  FindAwareShikiHtml,
} from "./ChatMarkdownFind";
import { IncrementalShikiCodeBlock } from "./IncrementalShikiCodeBlock";
import { createIncrementalMarkdownPlugin } from "../markdownIncremental";
const EXTERNAL_HTTP_HREF_PATTERN = /^https?:\/\//i;
const MARKDOWN_EXTERNAL_LINK_CLASS_NAME =
  "inline font-medium text-[var(--info-foreground)] underline-offset-2 hover:underline";
const MARKDOWN_EXTERNAL_LINK_ICON_CLASS_NAME = `${COMPOSER_INLINE_CHIP_TOKEN_ICON_CLASS_NAME} ${COMPOSER_INLINE_CHIP_ICON_LABEL_GAP_CLASS_NAME}`;
function isExternalHttpHref(href: string | undefined): href is string {
  return typeof href === "string" && EXTERNAL_HTTP_HREF_PATTERN.test(href);
}
class CodeHighlightErrorBoundary extends React.Component<
  {
    fallback: ReactNode;
    children: ReactNode;
  },
  {
    hasError: boolean;
  }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
    };
  }
  static getDerivedStateFromError() {
    return {
      hasError: true,
    };
  }
  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  wikiLinkRoot?: string | undefined;
  isStreaming?: boolean;
  className?: string | undefined;
  codeBlockMeta?: string | undefined;
  style?: CSSProperties | undefined;
  onImageExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
  findQuery?: string | undefined;
  findActiveRange?: ThreadFindRange | null | undefined;
  variant?: "assistant" | "user";
  mentionReferences?: ReadonlyArray<ProviderMentionReference> | undefined;
  terminalContexts?: ReadonlyArray<ParsedTerminalContextEntry> | undefined;
  // Receives the 1-based line of the task item in `text` so the caller can flip that `[ ]` marker at
  // the source (line numbers stay valid because the internal dollar protection is length- and
  // newline-preserving).
  onTaskToggle?: ((input: { sourceLine: number; checked: boolean }) => void) | undefined;
  knownAbsoluteFilePaths?: ReadonlyArray<string> | undefined;
}
const TaskItemSourceLineContext = React.createContext<number | null>(null);
function MarkdownTaskCheckbox(props: {
  checked: boolean;
  onTaskToggle: ChatMarkdownProps["onTaskToggle"];
}) {
  const { checked, onTaskToggle } = props;
  const sourceLine = React.useContext(TaskItemSourceLineContext);
  const interactive = onTaskToggle !== undefined && sourceLine !== null;
  return (
    <input
      type="checkbox"
      className="chat-markdown-task-checkbox"
      checked={checked}
      disabled={!interactive}
      {...(interactive
        ? {
            onChange: () =>
              onTaskToggle({
                sourceLine,
                checked: !checked,
              }),
          }
        : {})}
    />
  );
}
const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
type MarkdownRemarkPlugins = NonNullable<
  React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]
>;
type MarkdownRehypePlugins = NonNullable<
  React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]
>;
interface ParsedMarkdownProps {
  text: string;
  remarkPlugins: MarkdownRemarkPlugins;
  rehypePlugins: MarkdownRehypePlugins;
  components: Components;
}
const ParsedMarkdown = memo(function ParsedMarkdown(props: ParsedMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={props.remarkPlugins}
      rehypePlugins={props.rehypePlugins}
      components={props.components}
      urlTransform={markdownUrlTransform}
    >
      {props.text}
    </ReactMarkdown>
  );
});
const MARKDOWN_REMARK_PLUGINS: MarkdownRemarkPlugins = [
  remarkGfm,
  [
    remarkMath,
    {
      singleDollarTextMath: true,
    },
  ],
  remarkGithubAlerts,
];
// User prompts are casual typing, not authored markdown: hard-break single newlines and skip math
// entirely (the composer chip plugin is appended per render because it closes over the message's
// mention references).
const USER_MARKDOWN_REMARK_PLUGINS: MarkdownRemarkPlugins = [remarkGfm, remarkBreaks];
const USER_MARKDOWN_REHYPE_PLUGINS: MarkdownRehypePlugins = [];
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
const MARKDOWN_REHYPE_PLUGINS: MarkdownRehypePlugins = [
  [
    rehypeKatex,
    {
      output: "htmlAndMathml",
      strict: false,
      throwOnError: false,
    },
  ],
  rehypeRestoreLiteralDollars,
];
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
const CHAT_FIND_TEXT_TAG_NAME = "chat-find-text";
const CHAT_FIND_TEXT_START_ATTRIBUTE = "data-chat-find-text-start";
function remarkFindableText() {
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
function extractRawFenceInfo(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  return match?.[1] ?? "text";
}
function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (
    isValidElement<{
      children?: ReactNode;
    }>(node)
  ) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}
function extractCodeBlock(children: ReactNode): {
  className: string | undefined;
  code: string;
} | null {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }
  const onlyChild = childNodes[0];
  if (
    !isValidElement<{
      className?: string;
      children?: ReactNode;
    }>(onlyChild)
  ) {
    return null;
  }
  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
}
const INLINE_CODE_FILE_PATH_MAX_LENGTH = 120;
function inlineCodeFilePath(raw: string): string | null {
  const value = raw.trim().replace(/^['"`]+|['"`]+$/g, "");
  if (value.length === 0 || /\s/.test(value) || value.includes("://")) {
    return null;
  }
  const withoutPosition = value.replace(MARKDOWN_LINK_POSITION_SUFFIX_PATTERN, "");
  if (resolveMarkdownFileLinkTarget(withoutPosition)) {
    return value;
  }
  if (withoutPosition.length > INLINE_CODE_FILE_PATH_MAX_LENGTH) {
    return null;
  }
  return pathLooksLikeKnownFile(withoutPosition) ? value : null;
}
function ComposerChipElement(props: {
  serializedSegment: string | undefined;
  theme: "light" | "dark";
  mentionReferences: ReadonlyArray<ProviderMentionReference>;
}) {
  const segment = parseComposerChipSegment(props.serializedSegment);
  if (!segment) {
    return null;
  }
  if (segment.type === "skill") {
    return <InlineSkillChip skillName={segment.name} />;
  }
  if (segment.type === "mention") {
    return (
      <InlineMentionChip
        path={segment.path}
        theme={props.theme}
        mentionReferences={props.mentionReferences}
        {...(segment.kind
          ? {
              kind: segment.kind,
            }
          : {})}
      />
    );
  }
  if (segment.type === "agent-mention") {
    return <InlineAgentChip alias={segment.alias} color={segment.color} />;
  }
  if (segment.type === "slash-command") {
    return <InlineSlashCommandChip command={segment.command} />;
  }
  return <InlineLinkChip url={segment.url} interactive />;
}
function CodeBlockHeaderTitle({ fence }: { fence: CodeFenceInfo }) {
  if (fence.isFileReference && fence.fileName) {
    return (
      <span className="chat-markdown-codeblock__file" title={fence.filePath ?? fence.fileName}>
        <FileEntryIcon
          pathValue={fence.filePath ?? fence.fileName}
          kind="file"
          className="chat-markdown-codeblock__file-icon"
        />
        <span className="chat-markdown-codeblock__file-name">{fence.fileName}</span>
        {fence.directory ? (
          <span className="chat-markdown-codeblock__file-dir">{fence.directory}</span>
        ) : null}
        {fence.lineRange ? (
          <span className="chat-markdown-codeblock__file-lines">{fence.lineRange}</span>
        ) : null}
      </span>
    );
  }
  return <span className="chat-markdown-codeblock__lang">{fence.language}</span>;
}
function MarkdownCodeBlock({
  code,
  fence,
  children,
}: {
  code: string;
  fence: CodeFenceInfo;
  children: ReactNode;
}) {
  const { codeBlockMeta } = useContext(MarkdownRenderContext)!;
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopy = () => {
    void copyTextToClipboard(code)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch(() => undefined);
  };
  const toggleWrap = () => setWrap((previous) => !previous);
  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );
  return (
    <div className="chat-markdown-codeblock" data-wrap={wrap ? "true" : "false"}>
      <div className="chat-markdown-codeblock__header">
        <CodeBlockHeaderTitle fence={fence} />
        <div className="chat-markdown-codeblock__actions">
          {codeBlockMeta ? (
            <span className="mr-1 text-ui-xs tabular-nums text-muted-foreground">
              {codeBlockMeta}
            </span>
          ) : null}
          <IconButton
            className="chat-markdown-codeblock__action"
            onClick={toggleWrap}
            title={wrap ? "Disable soft wrap" : "Enable soft wrap"}
            label={wrap ? "Disable soft wrap" : "Enable soft wrap"}
            aria-pressed={wrap}
            data-active={wrap ? "true" : "false"}
            size="icon-xs"
            variant="ghost"
          >
            <TextWrapIcon className="size-3" />
          </IconButton>
          <IconButton
            className="chat-markdown-codeblock__action"
            onClick={handleCopy}
            title={copied ? "Copied" : "Copy code"}
            label={copied ? "Copied" : "Copy code"}
            size="icon-xs"
            variant="ghost"
          >
            {copied ? <CheckIcon className="size-3" /> : <Copy01Icon className="size-3" />}
          </IconButton>
        </div>
      </div>
      <div className="chat-markdown-codeblock__body">{children}</div>
    </div>
  );
}
interface SuspenseShikiCodeBlockProps {
  language: string;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
  sourceOffset: number;
}
type SyntaxHighlightingModule = typeof import("../lib/syntaxHighlighting");
let syntaxHighlightingModulePromise: Promise<SyntaxHighlightingModule> | null = null;
function getSyntaxHighlightingModulePromise(): Promise<SyntaxHighlightingModule> {
  syntaxHighlightingModulePromise ??= import("../lib/syntaxHighlighting");
  return syntaxHighlightingModulePromise;
}
const STREAMING_CODE_HIGHLIGHT_INTERVAL_MS = 160;
const STREAMING_CODE_HIGHLIGHT_MAX_INTERVAL_MS = 1_000;
const STREAMING_CODE_HIGHLIGHT_BASE_CHARS = 8_000;
const STREAMING_CODE_HIGHLIGHT_SLOW_CHARS = 80_000;
function streamingCodeHighlightIntervalMs(codeLength: number): number {
  if (codeLength <= STREAMING_CODE_HIGHLIGHT_BASE_CHARS) {
    return STREAMING_CODE_HIGHLIGHT_INTERVAL_MS;
  }
  const progress = Math.min(
    1,
    (codeLength - STREAMING_CODE_HIGHLIGHT_BASE_CHARS) /
      (STREAMING_CODE_HIGHLIGHT_SLOW_CHARS - STREAMING_CODE_HIGHLIGHT_BASE_CHARS),
  );
  return Math.round(
    STREAMING_CODE_HIGHLIGHT_INTERVAL_MS +
      progress * (STREAMING_CODE_HIGHLIGHT_MAX_INTERVAL_MS - STREAMING_CODE_HIGHLIGHT_INTERVAL_MS),
  );
}
function SuspenseShikiCodeBlock({
  language,
  code: liveCode,
  themeName,
  isStreaming,
  sourceOffset,
  oversizedFallback,
}: SuspenseShikiCodeBlockProps & {
  oversizedFallback: ReactNode;
}) {
  const code = useThrottledStreamingValue(
    liveCode,
    isStreaming,
    streamingCodeHighlightIntervalMs(liveCode.length),
  );
  const syntaxHighlighting = use(getSyntaxHighlightingModulePromise());
  // Shiki runs synchronously during render; past this size it freezes the window.
  if (code.length > syntaxHighlighting.MAX_SYNTAX_HIGHLIGHT_INPUT_CHARS) {
    return oversizedFallback;
  }
  return (
    <LoadedShikiCodeBlock
      syntaxHighlighting={syntaxHighlighting}
      language={language}
      code={code}
      themeName={themeName}
      isStreaming={isStreaming}
      sourceOffset={sourceOffset}
    />
  );
}
function LoadedShikiCodeBlock({
  syntaxHighlighting,
  language,
  code,
  themeName,
  isStreaming,
  sourceOffset,
}: SuspenseShikiCodeBlockProps & {
  syntaxHighlighting: SyntaxHighlightingModule;
}) {
  const [startedStreaming] = useState(isStreaming);
  if (startedStreaming) {
    return (
      <IncrementalShikiCodeBlock
        syntaxHighlighting={syntaxHighlighting}
        language={language}
        code={code}
        themeName={themeName}
        isStreaming={isStreaming}
        sourceOffset={sourceOffset}
      />
    );
  }
  const cacheKey = syntaxHighlighting.createSyntaxHighlightCacheKey(code, language, themeName);
  const cachedHighlightedHtml = !isStreaming
    ? syntaxHighlighting.getCachedSyntaxHighlightedHtml(cacheKey)
    : null;
  if (cachedHighlightedHtml != null) {
    return <FindAwareShikiHtml html={cachedHighlightedHtml} sourceOffset={sourceOffset} />;
  }

  // The uncached path lives in its own component: an early return above must not change this
  // component's hook order once the cache fills.
  return (
    <UncachedShikiCodeBlock
      syntaxHighlighting={syntaxHighlighting}
      cacheKey={cacheKey}
      language={language}
      code={code}
      themeName={themeName}
      isStreaming={isStreaming}
      sourceOffset={sourceOffset}
    />
  );
}
function UncachedShikiCodeBlock({
  syntaxHighlighting,
  cacheKey,
  language,
  code,
  themeName,
  isStreaming,
  sourceOffset,
}: SuspenseShikiCodeBlockProps & {
  syntaxHighlighting: SyntaxHighlightingModule;
  cacheKey: string;
}) {
  const highlighter = use(syntaxHighlighting.getSyntaxHighlighterPromise(language));
  const highlightedHtml = syntaxHighlighting.highlightCodeToHtmlWithFallback(
    highlighter,
    code,
    language,
    themeName,
  );
  useEffect(() => {
    if (!isStreaming) {
      syntaxHighlighting.cacheSyntaxHighlightedHtml(cacheKey, highlightedHtml, code);
    }
  }, [cacheKey, code, highlightedHtml, isStreaming, syntaxHighlighting]);
  return <FindAwareShikiHtml html={highlightedHtml} sourceOffset={sourceOffset} />;
}
interface MarkdownRenderContextValue {
  codeBlockMeta: ChatMarkdownProps["codeBlockMeta"];
  cwd: ChatMarkdownProps["cwd"];
  knownAbsoluteFilePaths: string[] | undefined;
  diffThemeName: DiffThemeName;
  isStreaming: boolean;
  isUserVariant: boolean;
  mentionReferences: ChatMarkdownProps["mentionReferences"];
  onImageExpand: ChatMarkdownProps["onImageExpand"];
  onTaskToggle: ChatMarkdownProps["onTaskToggle"];
  resolvedTheme: ReturnType<typeof useTheme>["resolvedTheme"];
  terminalContexts: ChatMarkdownProps["terminalContexts"];
  sourceText: string;
}
const MarkdownRenderContext = createContext<MarkdownRenderContextValue | null>(null);
const GITHUB_ALERTS: Record<
  GithubAlertKind,
  {
    title: string;
    icon: IconComponent;
  }
> = {
  note: {
    title: "Note",
    icon: InfoIcon,
  },
  tip: {
    title: "Tip",
    icon: LightbulbIcon,
  },
  important: {
    title: "Important",
    icon: InfoIcon,
  },
  warning: {
    title: "Warning",
    icon: TriangleAlertIcon,
  },
  caution: {
    title: "Caution",
    icon: OctagonAlertIcon,
  },
};
const MarkdownLinkContext = createContext(false);
const MARKDOWN_COMPONENTS: Components = {
  blockquote: function MarkdownBlockquote({ node: _node, children, ...props }) {
    const kind = (
      props as {
        "data-github-alert"?: GithubAlertKind;
      }
    )["data-github-alert"];
    const alert = kind ? GITHUB_ALERTS[kind] : undefined;
    if (!alert) return <blockquote {...props}>{children}</blockquote>;
    const Icon = alert.icon;
    return (
      <blockquote {...props}>
        <p className="markdown-alert-title">
          <Icon aria-hidden className="size-[1.1em] shrink-0" />
          {alert.title}
        </p>
        {children}
      </blockquote>
    );
  },
  a: function MarkdownLink({ node: _node, href, children, ...props }) {
    const { isUserVariant, cwd, knownAbsoluteFilePaths, resolvedTheme } =
      useContext(MarkdownRenderContext)!;
    const restoredHref = href ? restoreLiteralDollarPlaceholders(href) : href;
    if (restoredHref?.startsWith("#chat=")) {
      return (
        <MarkdownChatLink href={restoredHref} threadId={markdownChatLinkId(restoredHref)}>
          <MarkdownLinkContext value={true}>{children}</MarkdownLinkContext>
        </MarkdownChatLink>
      );
    }
    const linkedChildren = <MarkdownLinkContext value={true}>{children}</MarkdownLinkContext>;
    const isExternalHttp = isExternalHttpHref(restoredHref);
    if (isUserVariant && isExternalHttp) {
      const plainText = nodeToPlainText(children);
      if (
        plainText === restoredHref ||
        restoredHref === `http://${plainText}` ||
        restoredHref === `https://${plainText}`
      ) {
        return <InlineLinkChip url={restoredHref} interactive />;
      }
    }
    const targetPath = isExternalHttp
      ? null
      : resolveChatFileChipTarget(restoredHref, cwd, knownAbsoluteFilePaths);
    if (!targetPath) {
      return (
        <a
          {...props}
          href={restoredHref}
          target="_blank"
          rel="noopener noreferrer"
          className={isExternalHttp ? MARKDOWN_EXTERNAL_LINK_CLASS_NAME : props.className}
        >
          {isExternalHttp ? (
            <LinkChipIcon url={restoredHref} className={MARKDOWN_EXTERNAL_LINK_ICON_CLASS_NAME} />
          ) : null}
          {linkedChildren}
        </a>
      );
    }
    return (
      <OpenableFileChip
        targetPath={targetPath}
        theme={resolvedTheme}
        label={linkedChildren}
        {...(restoredHref
          ? {
              href: restoredHref,
            }
          : {})}
      />
    );
  },
  pre: function MarkdownPre({ node, children, ...props }) {
    const { sourceText, diffThemeName, isStreaming } = useContext(MarkdownRenderContext)!;
    const codeBlock = extractCodeBlock(children);
    if (!codeBlock) {
      return <pre {...props}>{children}</pre>;
    }
    const fence = parseCodeFenceInfo(extractRawFenceInfo(codeBlock.className));
    const code = dedentCode(codeBlock.code);
    const blockStart = node?.position?.start?.offset ?? 0;
    const codeOffsetInSource = sourceText.indexOf(code, blockStart);
    const sourceOffset = codeOffsetInSource < 0 ? blockStart : codeOffsetInSource;
    const highlightedFallback = (
      <pre {...props}>
        <FindAwareCodeFallback code={code} sourceOffset={sourceOffset}>
          {children}
        </FindAwareCodeFallback>
      </pre>
    );
    return (
      <MarkdownCodeBlock code={code} fence={fence}>
        <CodeHighlightErrorBoundary fallback={highlightedFallback}>
          <Suspense fallback={highlightedFallback}>
            <SuspenseShikiCodeBlock
              language={fence.language}
              code={code}
              themeName={diffThemeName}
              isStreaming={isStreaming}
              sourceOffset={sourceOffset}
              oversizedFallback={highlightedFallback}
            />
          </Suspense>
        </CodeHighlightErrorBoundary>
      </MarkdownCodeBlock>
    );
  },
  code: function MarkdownInlineCode({ node, className, children, ...props }) {
    const { sourceText, knownAbsoluteFilePaths, cwd, resolvedTheme } =
      useContext(MarkdownRenderContext)!;
    if (!className) {
      const filePath = inlineCodeFilePath(nodeToPlainText(children));
      if (filePath) {
        const nodeStart = node?.position?.start?.offset ?? 0;
        const filePathOffset = sourceText.indexOf(filePath, nodeStart);
        const sourceOffset = filePathOffset < 0 ? nodeStart : filePathOffset;
        const findLabelProps = {
          label: <FindAwareMarkdownText text={filePath} sourceOffset={sourceOffset} />,
        };
        const knownTarget = resolveChatFileChipTarget(filePath, undefined, knownAbsoluteFilePaths);
        if (knownTarget) {
          return (
            <OpenableFileChip targetPath={knownTarget} theme={resolvedTheme} {...findLabelProps} />
          );
        }
        if (resolveMarkdownFileLinkTarget(filePath, cwd) && cwd) {
          return (
            <VerifiedWorkspaceFileChip
              rawReference={filePath}
              cwd={cwd}
              theme={resolvedTheme}
              {...findLabelProps}
            />
          );
        }
      }
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  img: function MarkdownImage({ node: _node, src, alt: altProp, ...props }) {
    const { cwd, onImageExpand } = useContext(MarkdownRenderContext)!;
    const linked = useContext(MarkdownLinkContext);
    const alt = altProp ?? "";
    const restoredSrc = src ? restoreLiteralDollarPlaceholders(src) : "";
    if (isLocalImageMarkdownSrc(restoredSrc)) {
      return (
        <GeneratedMarkdownImage
          linked={linked}
          src={restoredSrc}
          alt={alt}
          cwd={cwd}
          onImageExpand={onImageExpand}
        />
      );
    }
    const image = <img {...props} src={restoredSrc || undefined} alt={alt} loading="lazy" />;
    if (linked || !onImageExpand || !restoredSrc) return image;
    return (
      <button
        type="button"
        className="inline-block cursor-zoom-in rounded-sm focus-visible:outline-2"
        aria-label={`Expand ${alt || "image"}`}
        onClick={() =>
          onImageExpand({
            images: [
              {
                src: restoredSrc,
                name: alt || "Image",
              },
            ],
            index: 0,
          })
        }
      >
        {image}
      </button>
    );
  },
  li: function MarkdownListItem({ node, children, ...props }) {
    const isTaskItem =
      typeof props.className === "string" && props.className.includes("task-list-item");
    const sourceLine = node?.position?.start.line ?? null;
    if (!isTaskItem || sourceLine === null) {
      return <li {...props}>{children}</li>;
    }
    return (
      <li {...props}>
        <TaskItemSourceLineContext.Provider value={sourceLine}>
          {children}
        </TaskItemSourceLineContext.Provider>
      </li>
    );
  },
  input: function MarkdownInput({ node: _node, ...props }) {
    const { onTaskToggle } = useContext(MarkdownRenderContext)!;
    if (props.type === "checkbox") {
      return <MarkdownTaskCheckbox checked={props.checked === true} onTaskToggle={onTaskToggle} />;
    }
    return <input {...props} />;
  },
  ...({
    [COMPOSER_CHIP_TAG_NAME]: function MarkdownComposerChip(props: {
      className?: string | undefined;
      [COMPOSER_CHIP_SEGMENT_ATTRIBUTE]?: string | undefined;
    }) {
      const { resolvedTheme, mentionReferences } = useContext(MarkdownRenderContext)!;
      return (
        <ComposerChipElement
          serializedSegment={props[COMPOSER_CHIP_SEGMENT_ATTRIBUTE]}
          theme={resolvedTheme}
          mentionReferences={mentionReferences ?? []}
        />
      );
    },
    [TERMINAL_CONTEXT_CHIP_TAG_NAME]: function MarkdownTerminalChip(props: {
      [TERMINAL_CONTEXT_CHIP_INDEX_ATTRIBUTE]?: string | undefined;
    }) {
      const { terminalContexts } = useContext(MarkdownRenderContext)!;
      const rawIndex = props[TERMINAL_CONTEXT_CHIP_INDEX_ATTRIBUTE];
      const index = rawIndex === undefined ? Number.NaN : Number.parseInt(rawIndex, 10);
      const context = Number.isInteger(index) ? terminalContexts?.[index] : undefined;
      if (!context) {
        return null;
      }
      const tooltipText =
        context.body.length > 0 ? `${context.header}\n${context.body}` : context.header;
      return <TerminalContextInlineChip label={context.header} tooltipText={tooltipText} />;
    },
    [CHAT_FIND_TEXT_TAG_NAME]: function MarkdownFindText(props: {
      children?: ReactNode;
      [CHAT_FIND_TEXT_START_ATTRIBUTE]?: string | undefined;
    }) {
      const rawSourceOffset = props[CHAT_FIND_TEXT_START_ATTRIBUTE];
      const sourceOffset =
        rawSourceOffset === undefined ? Number.NaN : Number.parseInt(rawSourceOffset, 10);
      const text = nodeToPlainText(props.children);
      if (!Number.isFinite(sourceOffset) || text.length === 0) {
        return <>{props.children}</>;
      }
      return <FindAwareMarkdownText text={text} sourceOffset={sourceOffset} />;
    },
  } as unknown as Components),
};
function ChatMarkdown({
  text,
  cwd,
  wikiLinkRoot,
  isStreaming: isStreamingProp,
  className: classNameProp,
  style,
  onImageExpand,
  findQuery: findQueryProp,
  findActiveRange: findActiveRangeProp,
  onTaskToggle,
  knownAbsoluteFilePaths: knownAbsoluteFilePathsProp,
  variant: variantProp,
  mentionReferences,
  terminalContexts,
  codeBlockMeta,
}: ChatMarkdownProps) {
  const isStreaming = isStreamingProp ?? false;
  const className = classNameProp ?? "text-sm leading-relaxed";
  const variant = variantProp ?? "assistant";
  const findQuery = findQueryProp ?? "";
  const findActiveRange = findActiveRangeProp ?? null;
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const isUserVariant = variant === "user";
  const extractedAbsoluteFilePaths = useMemo(() => extractAbsoluteFilesystemPaths(text), [text]);
  const knownAbsoluteFilePaths = useMemo(() => {
    if (
      (knownAbsoluteFilePathsProp === undefined || knownAbsoluteFilePathsProp.length === 0) &&
      extractedAbsoluteFilePaths.length === 0
    ) {
      return undefined;
    }
    return [...new Set([...(knownAbsoluteFilePathsProp ?? []), ...extractedAbsoluteFilePaths])];
  }, [extractedAbsoluteFilePaths, knownAbsoluteFilePathsProp]);
  const smoothedText = useSmoothStreamedText(text, isStreaming);
  const normalizedText = useMemo(
    () =>
      isUserVariant
        ? smoothedText
        : protectLiteralMarkdownDollars(repairMarkdownTableDelimiters(smoothedText)),
    [isUserVariant, smoothedText],
  );
  // While streaming, let React deprioritize and coalesce the markdown re-parse so a fast token stream
  // (one flush per ~100ms) doesn't re-render the full ReactMarkdown tree on every flush.
  const deferredNormalizedText = useDeferredValue(normalizedText);
  const renderedText = isStreaming ? deferredNormalizedText : normalizedText;
  const sourceText = useMemo(
    () => (isUserVariant ? text : repairMarkdownTableDelimiters(text)),
    [isUserVariant, text],
  );
  const composerChipsRemarkPlugin = useMemo(
    () =>
      isUserVariant
        ? createComposerChipsRemarkPlugin(
            mentionReferences ?? [],
            (terminalContexts ?? []).map((context, index) => ({
              label: formatInlineTerminalContextLabel(context.header),
              index,
            })),
          )
        : null,
    [isUserVariant, mentionReferences, terminalContexts],
  );
  const [incrementalMarkdownPlugin] = useState(createIncrementalMarkdownPlugin);
  const remarkPlugins = useMemo<MarkdownRemarkPlugins>(() => {
    if (composerChipsRemarkPlugin) {
      return [...USER_MARKDOWN_REMARK_PLUGINS, composerChipsRemarkPlugin, remarkFindableText];
    }
    return [
      ...MARKDOWN_REMARK_PLUGINS,
      incrementalMarkdownPlugin,
      [
        remarkWikiLinks,
        {
          root: wikiLinkRoot ?? cwd,
        },
      ],
      remarkFindableText,
    ];
  }, [composerChipsRemarkPlugin, incrementalMarkdownPlugin, wikiLinkRoot, cwd]);
  const rehypePlugins = isUserVariant ? USER_MARKDOWN_REHYPE_PLUGINS : MARKDOWN_REHYPE_PLUGINS;
  const rootRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    applyActiveChatFindMatch(rootRef.current, findActiveRange);
  }, [findActiveRange, findQuery, renderedText]);
  const renderContext = useMemo<MarkdownRenderContextValue>(
    () => ({
      codeBlockMeta,
      cwd,
      knownAbsoluteFilePaths,
      diffThemeName,
      isStreaming,
      isUserVariant,
      mentionReferences,
      onImageExpand,
      onTaskToggle,
      resolvedTheme,
      terminalContexts,
      sourceText,
    }),
    [
      codeBlockMeta,
      cwd,
      knownAbsoluteFilePaths,
      diffThemeName,
      isStreaming,
      isUserVariant,
      mentionReferences,
      onImageExpand,
      onTaskToggle,
      resolvedTheme,
      terminalContexts,
      sourceText,
    ],
  );
  return (
    <div
      ref={rootRef}
      className={`chat-markdown ${isUserVariant ? "chat-markdown--user " : ""}w-full min-w-0 ${className} text-foreground`}
      style={style}
    >
      <ChatFindRenderProvider
        query={findQuery}
        sourceText={sourceText}
        activeRange={findActiveRange}
      >
        <MarkdownRenderContext.Provider value={renderContext}>
          <ParsedMarkdown
            text={renderedText}
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={MARKDOWN_COMPONENTS}
          />
        </MarkdownRenderContext.Provider>
      </ChatFindRenderProvider>
    </div>
  );
}
export default memo(ChatMarkdown);
