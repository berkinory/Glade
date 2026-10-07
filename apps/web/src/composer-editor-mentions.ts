import { isBuiltInComposerSlashCommand } from "./composerSlashCommands";
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from "./lib/terminalContext";
import {
  createComposerMentionTokenRegex,
  extractComposerMentionPath,
  findThreadProviderMentionReferenceForToken,
  isPluginProviderMentionReference,
  providerMentionMatchesToken,
} from "./lib/composerMentions";
import {
  LINK_TOKEN_SOURCE,
  normalizeComposerLinkUrl,
  trimTrailingLinkPunctuation,
} from "./lib/linkChips";
import type { ProviderMentionReference } from "@glade/contracts/provider/providerDiscovery";
import { threadIdFromThreadMentionPath } from "@glade/shared/threads/threadMentions";

export type ComposerPromptSegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "mention";
      path: string;
      kind?: "path" | "plugin" | "thread";
      threadId?: string;

      tokenLength?: number;
    }
  | {
      type: "skill";
      name: string;
      prefix?: string;
    }
  | {
      type: "terminal-context";
      context: TerminalContextDraft | null;
    }
  | {
      type: "agent-mention";
      alias: string;
      color: string;
    }
  | {
      type: "link";
      url: string;
    };

const SKILL_TOKEN_REGEX = /(^|\s)([$/])([a-zA-Z][a-zA-Z0-9_:-]*)(?=\s)/g;
const DISPLAY_SKILL_TOKEN_REGEX = /(^|\s)([$/])([a-zA-Z][a-zA-Z0-9_:-]*)(?=\s|$)/g;
const LINK_TOKEN_TYPING_PATTERN = `${LINK_TOKEN_SOURCE}(?=\\s)`;
const LINK_TOKEN_DISPLAY_PATTERN = `${LINK_TOKEN_SOURCE}(?=\\s|$)`;

const LINK_TOKEN_REGEX = new RegExp(LINK_TOKEN_TYPING_PATTERN, "g");
const DISPLAY_LINK_TOKEN_REGEX = new RegExp(LINK_TOKEN_DISPLAY_PATTERN, "g");

const LINK_TOKEN_FIRST_REGEX = new RegExp(LINK_TOKEN_TYPING_PATTERN);
const DISPLAY_LINK_TOKEN_FIRST_REGEX = new RegExp(LINK_TOKEN_DISPLAY_PATTERN);

export function matchComposerLinkToken(
  text: string,
  options: { includeTrailingTokenAtEnd: boolean },
): { url: string; start: number; end: number } | null {
  if (!text.includes("http") && !text.includes(".")) {
    return null;
  }
  const regex = options.includeTrailingTokenAtEnd
    ? DISPLAY_LINK_TOKEN_FIRST_REGEX
    : LINK_TOKEN_FIRST_REGEX;
  const match = regex.exec(text);
  if (!match) {
    return null;
  }
  const rawUrl = trimTrailingLinkPunctuation(match[0]);
  const url = normalizeComposerLinkUrl(rawUrl);
  if (!url) {
    return null;
  }
  const start = match.index ?? 0;
  return { url, start, end: start + rawUrl.length };
}

function pushTextSegment(segments: ComposerPromptSegment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.type === "text") {
    last.text += text;
    return;
  }
  segments.push({ type: "text", text });
}

type InlineTokenMatch =
  | {
      kind: "mention" | "skill";
      value: string;
      skillPrefix?: string;
      start: number;
      end: number;
    }
  | {
      kind: "link";
      url: string;
      start: number;
      end: number;
    };

function collectInlineTokenMatches(
  text: string,
  options: {
    includeTrailingTokenAtEnd: boolean;
  },
): InlineTokenMatch[] {
  const matches: InlineTokenMatch[] = [];
  const mentionRegex = createComposerMentionTokenRegex({
    includeTrailingTokenAtEnd: options.includeTrailingTokenAtEnd,
  });
  const skillRegex = options.includeTrailingTokenAtEnd
    ? DISPLAY_SKILL_TOKEN_REGEX
    : SKILL_TOKEN_REGEX;
  const linkRegex = options.includeTrailingTokenAtEnd ? DISPLAY_LINK_TOKEN_REGEX : LINK_TOKEN_REGEX;

  const reservedRanges: Array<{ start: number; end: number }> = [];
  const isReserved = (pos: number): boolean =>
    reservedRanges.some((range) => pos >= range.start && pos < range.end);

  for (const match of text.matchAll(linkRegex)) {
    const start = match.index ?? 0;
    const rawUrl = trimTrailingLinkPunctuation(match[0]);
    const url = normalizeComposerLinkUrl(rawUrl);
    if (!url) continue;
    const end = start + rawUrl.length;
    reservedRanges.push({ start, end });
    matches.push({ kind: "link", url, start, end });
  }

  for (const match of text.matchAll(mentionRegex)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const path = extractComposerMentionPath(match);
    const matchIndex = match.index ?? 0;
    const start = matchIndex + prefix.length;
    const end = start + fullMatch.length - prefix.length;

    if (isReserved(start)) continue;

    if (path.length > 0) {
      matches.push({ kind: "mention", value: path, start, end });
    }
  }

  for (const match of text.matchAll(skillRegex)) {
    const fullMatch = match[0];
    const whitespace = match[1] ?? "";
    const skillPrefix = match[2] ?? "$";
    const name = match[3] ?? "";
    const matchIndex = match.index ?? 0;
    const start = matchIndex + whitespace.length;
    const end = start + fullMatch.length - whitespace.length;

    if (isReserved(start)) continue;

    if (name.length === 0) {
      continue;
    }

    const normalizedName = name.toLowerCase();
    if (skillPrefix === "/" && isBuiltInComposerSlashCommand(normalizedName)) {
      continue;
    }

    matches.push({ kind: "skill", value: name, skillPrefix, start, end });
  }

  matches.sort((a, b) => a.start - b.start);
  return matches;
}

function splitTextIntoPromptSegments(
  text: string,
  options: {
    includeTrailingTokenAtEnd: boolean;
    mentionReferences?: ReadonlyArray<ProviderMentionReference>;
  },
): ComposerPromptSegment[] {
  const segments: ComposerPromptSegment[] = [];
  if (!text) {
    return segments;
  }

  const matches = collectInlineTokenMatches(text, options);
  let cursor = 0;

  for (const match of matches) {
    if (match.start < cursor) continue;

    if (match.start > cursor) {
      pushTextSegment(segments, text.slice(cursor, match.start));
    }

    if (match.kind === "link") {
      segments.push({ type: "link", url: match.url });
    } else if (match.kind === "mention") {
      const threadMention = findThreadProviderMentionReferenceForToken(
        match.value,
        options.mentionReferences,
      );
      const isPluginMention =
        options.mentionReferences?.some(
          (mention) =>
            isPluginProviderMentionReference(mention) &&
            providerMentionMatchesToken(mention, match.value),
        ) ?? false;
      const tokenLength = match.end - match.start;
      const threadId = threadMention ? threadIdFromThreadMentionPath(threadMention.path) : null;
      segments.push(
        threadMention
          ? {
              type: "mention",
              path: match.value,
              kind: "thread",
              ...(threadId !== null ? { threadId } : {}),
              tokenLength,
            }
          : isPluginMention
            ? { type: "mention", path: match.value, kind: "plugin", tokenLength }
            : { type: "mention", path: match.value, tokenLength },
      );
    } else {
      const skillSegment: ComposerPromptSegment = match.skillPrefix
        ? { type: "skill", name: match.value, prefix: match.skillPrefix }
        : { type: "skill", name: match.value };
      segments.push(skillSegment);
    }

    cursor = match.end;
  }

  if (cursor < text.length) {
    pushTextSegment(segments, text.slice(cursor));
  }

  return segments;
}

export function splitPromptIntoDisplaySegments(
  prompt: string,
  mentionReferences: ReadonlyArray<ProviderMentionReference> = [],
): ComposerPromptSegment[] {
  return splitTextIntoPromptSegments(prompt, {
    includeTrailingTokenAtEnd: true,
    mentionReferences,
  });
}

export function splitPromptIntoComposerSegments(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft> = [],
  mentionReferences: ReadonlyArray<ProviderMentionReference> = [],
): ComposerPromptSegment[] {
  if (!prompt) {
    return [];
  }

  const segments: ComposerPromptSegment[] = [];
  let textCursor = 0;
  let terminalContextIndex = 0;

  for (let index = 0; index < prompt.length; index += 1) {
    if (prompt[index] !== INLINE_TERMINAL_CONTEXT_PLACEHOLDER) {
      continue;
    }

    if (index > textCursor) {
      segments.push(
        ...splitTextIntoPromptSegments(prompt.slice(textCursor, index), {
          includeTrailingTokenAtEnd: false,
          mentionReferences,
        }),
      );
    }
    segments.push({
      type: "terminal-context",
      context: terminalContexts[terminalContextIndex] ?? null,
    });
    terminalContextIndex += 1;
    textCursor = index + 1;
  }

  if (textCursor < prompt.length) {
    segments.push(
      ...splitTextIntoPromptSegments(prompt.slice(textCursor), {
        includeTrailingTokenAtEnd: false,
        mentionReferences,
      }),
    );
  }

  return segments;
}
