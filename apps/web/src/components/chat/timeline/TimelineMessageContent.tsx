import { type ProviderMentionReference } from "@glade/contracts/provider/providerDiscovery";
import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  getChatTranscriptUserMessageLineHeightPx,
  USER_MESSAGE_BUBBLE_RADIUS_CLASS_NAME,
  USER_MESSAGE_BUBBLE_SHELL_CHROME_CLASS_NAME,
} from "~/components/chat/chatTypography";
import {
  buildExpandedImagePreview,
  ExpandedImagePreview,
} from "~/components/chat/ExpandedImagePreview";
import { FileEntryIcon } from "~/components/chat/FileEntryIcon";
import { InlineAgentChip } from "~/components/chat/InlineAgentChip";
import { InlineMentionChip } from "~/components/chat/InlineMentionChip";
import { InlineSkillChip } from "~/components/chat/InlineSkillChip";
import { InlineSlashCommandChip } from "~/components/chat/InlineSlashCommandChip";
import { canSubmitUserMessageEdit } from "~/components/chat/MessagesTimeline.logic.rowTypes";
import {
  collectCaseInsensitiveSubstringRanges,
  splitTextWithFindMatches,
} from "~/components/chat/threadFind.logic";
import {
  USER_MESSAGE_COLLAPSED_FADE_LINES,
  USER_MESSAGE_COLLAPSED_MAX_LINES,
  userMessageLikelyOverflows,
} from "~/components/chat/userMessageCollapse";
import { observeUserMessageOverflow } from "~/components/chat/userMessageOverflowObserver";
import { resolveUserMessageMarkdownText } from "~/components/chat/userMessageTerminalContexts";
import ChatMarkdown from "~/components/ChatMarkdown";
import { InlineLinkChip } from "~/components/InlineLinkChip";
import { Button } from "~/components/ui/button";
import { splitPromptIntoDisplaySegments } from "~/composer-editor-mentions";
import { type ParsedTerminalContextEntry } from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { TimelineMessage } from "./timelineSupport";
export const UserImageAttachmentThumbnail = memo(function UserImageAttachmentThumbnail(props: {
  image: Extract<NonNullable<TimelineMessage["attachments"]>[number], { type: "image" }>;
  userImages: Array<
    Extract<NonNullable<TimelineMessage["attachments"]>[number], { type: "image" }>
  >;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onTimelineImageLoad: () => void;
  resolvedTheme: "light" | "dark";
}) {
  return (
    <button
      type="button"
      className="flex size-15 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-background/82 text-left shadow-[0_1px_0_rgba(255,255,255,0.2)_inset] transition-colors hover:bg-background/94"
      aria-label={`Preview ${props.image.name}`}
      title={props.image.name}
      onClick={() => {
        const preview = buildExpandedImagePreview(props.userImages, props.image.id);
        if (!preview) return;
        props.onImageExpand(preview);
      }}
    >
      {props.image.previewUrl ? (
        <img
          src={props.image.previewUrl}
          alt={props.image.name}
          className="size-full object-cover"
          onLoad={props.onTimelineImageLoad}
          onError={props.onTimelineImageLoad}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <FileEntryIcon
            pathValue={props.image.name}
            kind="file"
            theme={props.resolvedTheme}
            className="size-4 opacity-70"
          />
        </div>
      )}
    </button>
  );
});
function renderFindWrappedText(
  text: string,
  keyPrefix: string,
  query: string | undefined,
  activeRange: { startOffset: number; endOffset: number } | null,
  sourceOffset = 0,
): ReactNode {
  if (!query) {
    return text;
  }
  const parts = splitTextWithFindMatches(text, query, activeRange, sourceOffset);
  if (parts.length === 1 && !parts[0]!.match) {
    return text;
  }
  return parts.map((part, partIndex) =>
    part.match ? (
      <span
        key={`${keyPrefix}:${partIndex}`}
        className={part.active ? "chat-find-match chat-find-match-active" : "chat-find-match"}
        data-chat-find-match={part.active ? "active" : "true"}
        data-chat-find-start={part.startOffset}
      >
        {part.text}
      </span>
    ) : (
      part.text
    ),
  );
}
function renderUserMessageInlineText(
  text: string,
  keyPrefix: string,
  resolvedTheme: "light" | "dark",
  mentionReferences: ReadonlyArray<ProviderMentionReference> = [],
  findQuery?: string,
  findActiveRange: { startOffset: number; endOffset: number } | null = null,
): ReactNode[] {
  let sourceOffset = 0;
  return splitPromptIntoDisplaySegments(text, mentionReferences).flatMap((segment, index) => {
    const key = `${keyPrefix}:${index}`;
    if (segment.type === "text") {
      const content =
        segment.text.length > 0
          ? [
              <span key={`${key}:text`}>
                {renderFindWrappedText(
                  segment.text,
                  `${key}:find`,
                  findQuery,
                  findActiveRange,
                  sourceOffset,
                )}
              </span>,
            ]
          : [];
      sourceOffset += segment.text.length;
      return content;
    }
    if (segment.type === "skill") {
      const chip = <InlineSkillChip skillName={segment.name} />;
      const highlighted =
        findQuery && collectCaseInsensitiveSubstringRanges(segment.name, findQuery).length > 0 ? (
          <span
            key={`${key}:skill`}
            className="chat-find-match"
            data-chat-find-match="true"
            data-chat-find-start={sourceOffset}
          >
            {chip}
          </span>
        ) : (
          <span key={`${key}:skill`}>{chip}</span>
        );
      sourceOffset += segment.name.length;
      return [highlighted];
    }
    if (segment.type === "mention") {
      return [
        <InlineMentionChip
          key={`${key}:mention`}
          path={segment.path}
          theme={resolvedTheme}
          mentionReferences={mentionReferences}
          {...(segment.kind ? { kind: segment.kind } : {})}
        />,
      ];
    }
    if (segment.type === "agent-mention") {
      return [<InlineAgentChip key={`${key}:agent`} alias={segment.alias} color={segment.color} />];
    }
    if (segment.type === "link") {
      return [<InlineLinkChip key={`${key}:link`} url={segment.url} interactive />];
    }
    if (segment.type === "slash-command") {
      return [<InlineSlashCommandChip key={`${key}:command`} command={segment.command} />];
    }
    return [];
  });
}
function hasOnlyInlineSkillChips(
  text: string,
  mentionReferences: ReadonlyArray<ProviderMentionReference> = [],
): boolean {
  const segments = splitPromptIntoDisplaySegments(text, mentionReferences);
  let skillCount = 0;

  for (const segment of segments) {
    if (segment.type === "skill") {
      skillCount += 1;
      continue;
    }
    if (segment.type === "text" && segment.text.trim().length === 0) {
      continue;
    }
    return false;
  }

  return skillCount > 0;
}
export const UserMessageEditForm = memo(function UserMessageEditForm(props: {
  initialValue: string;
  disabled: boolean;
  allowEmpty: boolean;
  chatTypographyStyle: CSSProperties;
  borderClassName: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(props.initialValue);
  const canSubmit = canSubmitUserMessageEdit({
    draft,
    allowEmpty: props.allowEmpty,
    disabled: props.disabled,
  });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onCancel();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSubmit) {
        props.onSubmit(draft);
      }
    }
  };

  return (
    <form
      className={cn(
        "w-full bg-[var(--app-user-message-background)]",
        USER_MESSAGE_BUBBLE_RADIUS_CLASS_NAME,
        props.borderClassName,
        USER_MESSAGE_BUBBLE_SHELL_CHROME_CLASS_NAME,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          props.onSubmit(draft);
        }
      }}
    >
      <textarea
        ref={textareaRef}
        value={draft}
        disabled={props.disabled}
        rows={1}
        aria-label="Edit message"
        className="max-h-60 min-h-0 w-full resize-none overflow-y-auto border-0 bg-transparent p-0 font-system-ui text-foreground outline-none placeholder:text-muted-foreground/45 disabled:opacity-70"
        style={props.chatTypographyStyle}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={props.disabled}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={!canSubmit}>
          Send
        </Button>
      </div>
    </form>
  );
});
function measureUserMessageOverflow(
  collapsed: boolean,
  contentRef: RefObject<HTMLDivElement | null>,
  setOverflowing: (overflowing: boolean) => void,
): (() => void) | undefined {
  if (!collapsed) {
    return undefined;
  }
  const element = contentRef.current;
  if (!element) {
    return undefined;
  }
  const measure = () => {
    setOverflowing(element.scrollHeight - element.clientHeight > 1);
  };
  measure();
  return observeUserMessageOverflow(element, measure);
}
export const UserMessageCollapsibleText = memo(function UserMessageCollapsibleText(props: {
  text: string;
  expanded: boolean;
  chatFontSizePx: number;
  onToggle: () => void;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const [overflowing, setOverflowing] = useState(() => userMessageLikelyOverflows(props.text));
  const collapsed = !props.expanded;

  useLayoutEffect(
    () => measureUserMessageOverflow(collapsed, contentRef, setOverflowing),
    [collapsed, props.text],
  );

  const lineHeightPx = getChatTranscriptUserMessageLineHeightPx(props.chatFontSizePx);
  const clampHeightPx = USER_MESSAGE_COLLAPSED_MAX_LINES * lineHeightPx;
  const fadeStartPx = clampHeightPx - USER_MESSAGE_COLLAPSED_FADE_LINES * lineHeightPx;
  const clamped = collapsed && overflowing;

  return (
    <>
      <div
        id={contentId}
        ref={contentRef}
        data-user-message-clamp={clamped ? "true" : "false"}
        className={cn("min-w-0", collapsed && "overflow-hidden")}
        style={
          collapsed
            ? {
                maxHeight: `${clampHeightPx}px`,
                ...(clamped
                  ? {
                      maskImage: `linear-gradient(to bottom, black ${fadeStartPx}px, transparent 100%)`,
                    }
                  : {}),
              }
            : undefined
        }
      >
        {props.children}
      </div>
      {(clamped || props.expanded) && (
        <button
          type="button"
          data-scroll-anchor-ignore
          className="mt-1 block text-muted-foreground/55 transition-colors duration-120 hover:text-foreground/72"
          style={{ fontSize: `${props.chatFontSizePx}px` }}
          aria-expanded={props.expanded}
          aria-controls={contentId}
          onClick={props.onToggle}
        >
          {props.expanded ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
});
export const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  mentionReferences: ReadonlyArray<ProviderMentionReference>;
  terminalContexts: ParsedTerminalContextEntry[];
  chatTypographyStyle: CSSProperties;
  resolvedTheme: "light" | "dark";
  markdownCwd: string | undefined;
  findQuery?: string;
  findActiveRange?: { startOffset: number; endOffset: number } | null;
}) {
  if (props.terminalContexts.length > 0) {
    const markdownText = resolveUserMessageMarkdownText(props.text, props.terminalContexts);
    if (markdownText.length === 0) {
      return null;
    }
    return (
      <ChatMarkdown
        text={markdownText}
        cwd={props.markdownCwd}
        variant="user"
        mentionReferences={props.mentionReferences}
        terminalContexts={props.terminalContexts}
        className="font-system-ui wrap-break-word"
        style={props.chatTypographyStyle}
        findQuery={props.findQuery}
        findActiveRange={props.findActiveRange}
      />
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  if (
    props.terminalContexts.length === 0 &&
    hasOnlyInlineSkillChips(props.text, props.mentionReferences)
  ) {
    return (
      <div
        className="flex max-w-full min-w-0 items-center leading-none text-foreground [&>span]:translate-y-0"
        style={props.chatTypographyStyle}
      >
        {renderUserMessageInlineText(
          props.text,
          "user-message-inline-chip-only",
          props.resolvedTheme,
          props.mentionReferences,
          props.findQuery,
          props.findActiveRange ?? null,
        )}
      </div>
    );
  }

  return (
    <ChatMarkdown
      variant="user"
      text={props.text}
      cwd={props.markdownCwd}
      isStreaming={false}
      mentionReferences={props.mentionReferences}
      className="font-system-ui"
      style={props.chatTypographyStyle}
      findQuery={props.findQuery}
      findActiveRange={props.findActiveRange}
    />
  );
});
