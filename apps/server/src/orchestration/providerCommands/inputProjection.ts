import { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type ProviderSkillReference } from "@glade/contracts/provider/providerDiscovery";
import {
  type ChatAttachment,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
} from "@glade/contracts/orchestration/threadEntities";

export function toNonEmptyProviderInput(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function normalizeSkillMentionTextForProvider(input: {
  readonly provider: ProviderKind;
  readonly messageText: string;
  readonly skills?: ReadonlyArray<ProviderSkillReference>;
}): string {
  if (input.provider !== "codex" || !input.skills || input.skills.length === 0) {
    return input.messageText;
  }

  let nextText = input.messageText;
  for (const skill of input.skills) {
    const escapedName = skill.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    nextText = nextText.replace(
      new RegExp(`(^|\\s)/${escapedName}(?=\\s|$)`, "gi"),
      `$1$${skill.name}`,
    );
  }
  return nextText;
}

export function attachmentTitleSeed(attachment: ChatAttachment | undefined): string {
  if (!attachment) {
    return "";
  }
  if (attachment.type === "image" || attachment.type === "file") {
    return attachment.name;
  }
  return attachment.text.trim();
}

export const PROVIDER_INPUT_SAFETY_MARGIN_CHARS = 1_000;

const THREAD_MENTION_CONTEXT_SUFFIX_PREFIX_CHARS = 2;

type ProviderContextTag = "handoff_context" | "thread_context";

export interface BootstrapContextSelection {
  readonly tag: ProviderContextTag;
  readonly contextText: string;
  readonly wrapLatestUserMessage: boolean;
}

export function wrapProviderContext(input: {
  readonly tag: ProviderContextTag;
  readonly contextText: string;
  readonly messageText: string;
  readonly wrapLatestUserMessage: boolean;
}): string {
  const messageSection = input.wrapLatestUserMessage
    ? `<latest_user_message>\n${input.messageText}\n</latest_user_message>`
    : input.messageText;
  return `<${input.tag}>\n${input.contextText}\n</${input.tag}>\n\n${messageSection}`;
}

export function availableProviderContextChars(input: {
  readonly tag: ProviderContextTag;
  readonly messageText: string;
  readonly wrapLatestUserMessage: boolean;
  readonly reservedChars?: number;
}): number {
  return Math.max(
    0,
    PROVIDER_SEND_TURN_MAX_INPUT_CHARS -
      wrapProviderContext({ ...input, contextText: "" }).length -
      (input.reservedChars ?? 0),
  );
}

export function availableThreadMentionContextChars(messageText: string, reservedChars = 0): number {
  return Math.max(
    0,
    PROVIDER_SEND_TURN_MAX_INPUT_CHARS -
      messageText.length -
      PROVIDER_INPUT_SAFETY_MARGIN_CHARS -
      THREAD_MENTION_CONTEXT_SUFFIX_PREFIX_CHARS -
      reservedChars,
  );
}

export function providerPromptOverflowIssue(): string {
  return "The latest message is too long. Shorten the message and retry.";
}
