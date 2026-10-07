import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { asRecord } from "@glade/shared/transport/payloadValues";
import path from "node:path";

import {
  CODEX_GENERATED_IMAGE_ARTIFACT_KIND,
  type CodexGeneratedImageArtifact,
} from "@glade/contracts/provider/runtimePayloads";
import { type ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { Option, Schema } from "effect";
import { isSupportedLocalImagePath as isSupportedLocalImagePathShared } from "@glade/shared/attachments/localPreviewFiles";

import { resolveCodexHomeAllowlistCandidates } from "./codexHomePaths.ts";

const GeneratedImageItem = Schema.Struct({
  type: Schema.Literal("imageGeneration"),
  id: Schema.String,
  savedPath: Schema.optional(Schema.NullOr(Schema.String)),
  result: Schema.optional(Schema.String),
});

export interface CodexGeneratedImageReference {
  readonly path: string;
  readonly callId?: string;
}

export function isCodexGeneratedImageItemType(raw: unknown): boolean {
  return raw === "imageGeneration";
}

const isSupportedLocalImagePath = isSupportedLocalImagePathShared;

export function resolveCodexGeneratedImagesRoots(homePath?: string): readonly string[] {
  const homes = resolveCodexHomeAllowlistCandidates(homePath?.trim() ? { homePath } : {});
  return homes.map((home) => path.join(home, "generated_images"));
}

export function firstStringValue(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = nonEmptyTrimmed(record[key]);
    if (value) return value;
  }
  return undefined;
}

function sanitizeCodexGeneratedImagePayload(value: unknown): unknown {
  const decoded = Schema.decodeUnknownOption(GeneratedImageItem)(value);
  if (Option.isNone(decoded) || !decoded.value.result) return value;
  const record = asRecord(value);
  if (!record) return value;
  const { result: _result, ...withoutResult } = record;
  return { ...withoutResult, result_elided_for_relay: true };
}

export function sanitizeNestedCodexGeneratedImagePayloads(value: unknown): unknown {
  const sanitized = sanitizeCodexGeneratedImagePayload(value);
  const record = asRecord(sanitized);
  if (!record) return sanitized;
  const overrides: Record<string, unknown> = {};
  for (const key of ["item", "payload", "data", "event"]) {
    const nested = record[key];
    if (!asRecord(nested)) continue;
    const next = sanitizeNestedCodexGeneratedImagePayloads(nested);
    if (next !== nested) overrides[key] = next;
  }
  return Object.keys(overrides).length > 0 ? { ...record, ...overrides } : sanitized;
}

export function extractCodexGeneratedImageReference(
  value: unknown,
): CodexGeneratedImageReference | undefined {
  const decoded = Schema.decodeUnknownOption(GeneratedImageItem)(value);
  if (Option.isNone(decoded)) return undefined;
  const imagePath = nonEmptyTrimmed(decoded.value.savedPath);
  if (!imagePath || !path.isAbsolute(imagePath) || !isSupportedLocalImagePath(imagePath)) {
    return undefined;
  }
  const callId = nonEmptyTrimmed(decoded.value.id);
  return { path: imagePath, ...(callId ? { callId } : {}) };
}

export function codexGeneratedImageArtifact(
  reference: CodexGeneratedImageReference,
): CodexGeneratedImageArtifact {
  return {
    kind: CODEX_GENERATED_IMAGE_ARTIFACT_KIND,
    path: reference.path,
    ...(reference.callId ? { callId: reference.callId } : {}),
  };
}

export function isCodexGeneratedImageArtifact(
  value: unknown,
): value is CodexGeneratedImageArtifact {
  const record = asRecord(value) ?? undefined;
  return (
    record?.kind === CODEX_GENERATED_IMAGE_ARTIFACT_KIND &&
    typeof record.path === "string" &&
    record.path.trim().length > 0
  );
}

function markdownImagePath(filePath: string): string {
  const trimmed = filePath.trim();
  if (trimmed.includes(")") || trimmed.includes(" ") || trimmed.includes("%")) {
    const escaped = trimmed.replaceAll("%", "%25").replaceAll(">", "%3E").replaceAll(")", "%29");
    return `<${escaped}>`;
  }
  return trimmed;
}

export function generatedImageMarkdown(filePath: string): string {
  return `![Generated image](${markdownImagePath(filePath)})`;
}

export function generatedImagePathFromRuntimeEvent(
  event: ProviderRuntimeEvent,
): string | undefined {
  if (event.type !== "item.completed" || event.payload.itemType !== "image_generation") {
    return undefined;
  }
  const artifact = isCodexGeneratedImageArtifact(event.payload.data)
    ? event.payload.data
    : undefined;
  return artifact?.path;
}
