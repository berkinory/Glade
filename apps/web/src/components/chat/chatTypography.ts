import type { CSSProperties } from "react";
import { DEFAULT_CHAT_FONT_SIZE_PX, normalizeChatFontSizePx } from "../../appSettings";

export const USER_MESSAGE_BUBBLE_RADIUS_CLASS_NAME =
  "chat-user-message-bubble rounded-[var(--radius-user-message)]";
const USER_MESSAGE_BUBBLE_SHELL_PADDING_CLASS_NAME = "py-2.5";
const USER_MESSAGE_BUBBLE_SHELL_HORIZONTAL_PADDING_CLASS_NAME = "px-3.5";
export const USER_MESSAGE_BUBBLE_SHELL_CHROME_CLASS_NAME = [
  USER_MESSAGE_BUBBLE_SHELL_HORIZONTAL_PADDING_CLASS_NAME,
  USER_MESSAGE_BUBBLE_SHELL_PADDING_CLASS_NAME,
].join(" ");

export const USER_MESSAGE_BUBBLE_BORDER_CLASS_NAME = "border border-transparent";

const CHAT_TRANSCRIPT_LINE_HEIGHT_RATIO = 1.625;

function getChatTranscriptLineHeightPx(chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX): number {
  return normalizeChatFontSizePx(chatFontSizePx) * CHAT_TRANSCRIPT_LINE_HEIGHT_RATIO;
}

export function getChatTranscriptUserMessageLineHeightPx(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): number {
  return getChatTranscriptLineHeightPx(chatFontSizePx);
}

function buildChatTextStyle(fontSizePx: number, lineHeightPx: number): CSSProperties {
  return {
    fontSize: `${fontSizePx}px`,
    lineHeight: `${lineHeightPx}px`,
  };
}

export function getChatTranscriptTextStyle(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): CSSProperties {
  const normalizedChatFontSizePx = normalizeChatFontSizePx(chatFontSizePx);
  return buildChatTextStyle(
    normalizedChatFontSizePx,
    getChatTranscriptLineHeightPx(normalizedChatFontSizePx),
  );
}

export function getChatTranscriptUserMessageTextStyle(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): CSSProperties {
  const normalizedChatFontSizePx = normalizeChatFontSizePx(chatFontSizePx);
  return buildChatTextStyle(
    normalizedChatFontSizePx,
    getChatTranscriptUserMessageLineHeightPx(normalizedChatFontSizePx),
  );
}

export function getChatMessageFooterTextStyle(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): CSSProperties {
  const normalizedChatFontSizePx = normalizeChatFontSizePx(chatFontSizePx);
  const footerFontSizePx = Math.max(8, normalizedChatFontSizePx - 2);
  return buildChatTextStyle(footerFontSizePx, getChatTranscriptLineHeightPx(footerFontSizePx));
}
