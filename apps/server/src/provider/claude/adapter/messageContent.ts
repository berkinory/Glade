import { type UserInputQuestion } from "@glade/contracts/provider/runtimePayloads";
import { type ProviderUserInputAnswers } from "@glade/contracts/provider/sessionPolicy";
import {
  RuntimeItemId,
  TurnId,
  ApprovalRequestId,
  RuntimeRequestId,
  ProviderItemId,
} from "@glade/contracts/core/baseSchemas";
import { type ProviderSendTurnInput } from "@glade/contracts/provider/provider";
import { withProviderPlanModePrompt } from "../../core/planMode.ts";
import type { SDKUserMessage, SDKResultMessage, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { FileSystem, Effect } from "effect";
import { ProviderAdapterRequestError } from "../../core/Errors.ts";
import { resolveProviderAttachmentPath } from "../../core/providerAttachmentPaths.ts";
import { buildFileAttachmentsPromptBlock } from "../../core/attachmentProjection.ts";
import { type RuntimeTurnState } from "@glade/contracts/provider/runtimeMetadata";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { isClaudeNativeSlashCommand } from "./commandPresentation";
import { PROVIDER, ClaudeTextStreamKind, ClaudeSessionContext } from "./sessionTypes";
import {
  toMessage,
  resultErrorsText,
  isInterruptedResult,
  sanitizeClaudeDisplayText,
} from "./streamErrors";

function coerceClaudeAnswerValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join(", ");
  }
  return "";
}

export function remapAnswersToClaudeQuestionText(
  questions: ReadonlyArray<UserInputQuestion>,
  answers: ProviderUserInputAnswers,
): Record<string, string> {
  const remapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers)) {
    remapped[key] = coerceClaudeAnswerValue(value);
  }

  for (const question of questions) {
    if (Object.hasOwn(remapped, question.question)) {
      continue;
    }

    if (Object.hasOwn(remapped, question.id)) {
      remapped[question.question] = remapped[question.id]!;
      delete remapped[question.id];
    }
  }

  return remapped;
}

export function asRuntimeItemId(value: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(value);
}

export function asCanonicalTurnId(value: TurnId): TurnId {
  return value;
}

export function asRuntimeRequestId(value: ApprovalRequestId): RuntimeRequestId {
  return RuntimeRequestId.makeUnsafe(value);
}

const SUPPORTED_CLAUDE_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function buildPromptText(
  input: ProviderSendTurnInput,
  nativeCommandNames?: ReadonlySet<string>,
): string {
  if (isClaudeNativeSlashCommand(input.input, nativeCommandNames)) return input.input!.trim();
  const basePrompt = input.input?.trim() ?? "";
  return withProviderPlanModePrompt({
    text: basePrompt,
    interactionMode: input.interactionMode,
  });
}

function buildUserMessage(input: {
  readonly sdkContent: Array<Record<string, unknown>>;
}): SDKUserMessage {
  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: input.sdkContent,
    },
  } as unknown as SDKUserMessage;
}

function buildClaudeImageContentBlock(input: {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}): Record<string, unknown> {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: input.mimeType,
      data: Buffer.from(input.bytes).toString("base64"),
    },
  };
}

export function buildUserMessageEffect(
  input: ProviderSendTurnInput,
  dependencies: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly attachmentsDir: string;
    readonly nativeCommandNames?: ReadonlySet<string> | undefined;
  },
): Effect.Effect<SDKUserMessage, ProviderAdapterRequestError> {
  return Effect.gen(function* () {
    const text = buildPromptText(input, dependencies.nativeCommandNames);
    const sdkContent: Array<Record<string, unknown>> = [];

    if (text.length > 0) {
      sdkContent.push({ type: "text", text });
    }

    for (const attachment of input.attachments ?? []) {
      if (attachment.type !== "image") {
        continue;
      }

      if (!SUPPORTED_CLAUDE_IMAGE_MIME_TYPES.has(attachment.mimeType.toLowerCase())) {
        continue;
      }

      const attachmentPath = resolveProviderAttachmentPath({
        attachmentsDir: dependencies.attachmentsDir,
        attachment,
      });
      if (!attachmentPath) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "turn/start",
          detail: `Invalid attachment id '${attachment.id}'.`,
        });
      }

      const bytes = yield* dependencies.fileSystem.readFile(attachmentPath).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/start",
              detail: toMessage(cause, "Failed to read attachment file."),
              cause,
            }),
        ),
      );

      sdkContent.push(
        buildClaudeImageContentBlock({
          mimeType: attachment.mimeType.toLowerCase(),
          bytes,
        }),
      );
    }

    const fileBlock = buildFileAttachmentsPromptBlock({
      attachments: input.attachments,
      attachmentsDir: dependencies.attachmentsDir,
      include: "all-files",
      includeImage: (attachment) =>
        !SUPPORTED_CLAUDE_IMAGE_MIME_TYPES.has(attachment.mimeType.toLowerCase()),
    });
    if (fileBlock) {
      sdkContent.push({ type: "text", text: fileBlock });
    }

    return buildUserMessage({ sdkContent });
  });
}

export function turnStatusFromResult(result: SDKResultMessage): RuntimeTurnState {
  if (result.subtype === "success") {
    return "completed";
  }

  const errors = resultErrorsText(result);
  if (isInterruptedResult(result)) {
    return "interrupted";
  }
  if (errors.includes("cancel")) {
    return "cancelled";
  }
  return "failed";
}

export function streamKindFromDeltaType(deltaType: string): ClaudeTextStreamKind {
  return deltaType.includes("thinking") ? "reasoning_text" : "assistant_text";
}

export function nativeProviderRefs(
  context: ClaudeSessionContext,
  options?: {
    readonly providerItemId?: string | undefined;
  },
): NonNullable<ProviderRuntimeEvent["providerRefs"]> {
  return {
    ...context.subagentRefs,
    ...(options?.providerItemId
      ? { providerItemId: ProviderItemId.makeUnsafe(options.providerItemId) }
      : {}),
  };
}

export function extractAssistantTextBlocks(message: SDKMessage): Array<string> {
  if (message.type !== "assistant") {
    return [];
  }

  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const fragments: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const candidate = block as { type?: unknown; text?: unknown };
    const sanitizedText =
      candidate.type === "text" && typeof candidate.text === "string"
        ? sanitizeClaudeDisplayText(candidate.text)
        : "";
    if (candidate.type === "text" && sanitizedText.length > 0) {
      fragments.push(sanitizedText);
    }
  }

  return fragments;
}

export function extractContentBlockText(block: unknown): string {
  if (!block || typeof block !== "object") {
    return "";
  }

  const candidate = block as { type?: unknown; text?: unknown };
  return candidate.type === "text" && typeof candidate.text === "string"
    ? sanitizeClaudeDisplayText(candidate.text)
    : "";
}

export function extractTextContent(value: unknown): string {
  if (typeof value === "string") {
    return sanitizeClaudeDisplayText(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => extractTextContent(entry)).join("");
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as {
    text?: unknown;
    content?: unknown;
  };

  if (typeof record.text === "string") {
    return sanitizeClaudeDisplayText(record.text);
  }

  return extractTextContent(record.content);
}

export function extractExitPlanModePlan(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as {
    plan?: unknown;
  };
  return typeof record.plan === "string" && record.plan.trim().length > 0
    ? record.plan.trim()
    : undefined;
}

export function exitPlanCaptureKey(input: {
  readonly toolUseId?: string | undefined;
  readonly planMarkdown: string;
}): string {
  return input.toolUseId && input.toolUseId.length > 0
    ? `tool:${input.toolUseId}`
    : `plan:${input.planMarkdown}`;
}
