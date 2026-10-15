import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { Effect, FileSystem, Layer, Schema } from "effect";

import { redactDiagnosticText } from "../../agentGateway/diagnosticSanitizer";
import { teardownChildProcessTree } from "../../platform/supervisedProcessTeardown";
import { loadClaudeAgentSdk } from "../../provider/claude/claudeAgentSdk";
import { buildClaudeProcessEnv } from "../../provider/claude/claudeProcessEnv";
import { claudeModelOptions } from "../../provider/claude/claudeModelOptions";
import { spawnOwnedClaudeCodeProcess } from "../../provider/claude/adapter/sdkProcessRuntime";
import type { ClaudeOwnedProcess } from "../../provider/claude/adapter/adapterConfiguration";
import { resolveProviderAttachmentPath } from "../../provider/core/providerAttachmentPaths";
import { ServerConfig } from "../../server/config";
import { TextGenerationError } from "../Errors";
import {
  ClaudeTextGeneration,
  type BranchNameGenerationInput,
  type TextGenerationOperation,
} from "../Services/TextGeneration";
import { makeStructuredTextGeneration } from "../structuredTextGeneration";
import { GIT_WRITING_INSTRUCTIONS, toJsonSchemaObject } from "../textGenerationShared";

const CLAUDE_TIMEOUT_MS = 180_000;
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
type ClaudeContentBlock = Extract<SDKUserMessage["message"]["content"], readonly unknown[]>[number];

function isImageMimeType(value: string): value is ImageMimeType {
  return IMAGE_MIME_TYPES.some((mimeType) => mimeType === value);
}

const makeClaudeTextGeneration = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const serverConfig = yield* ServerConfig;

  const readImages = (input: BranchNameGenerationInput) =>
    Effect.gen(function* () {
      const blocks: ClaudeContentBlock[] = [];
      for (const attachment of input.attachments ?? []) {
        if (attachment.type !== "image" || !isImageMimeType(attachment.mimeType)) continue;
        const filePath = resolveProviderAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!filePath) {
          return yield* new TextGenerationError({
            operation: "generateBranchName",
            detail: "Invalid image attachment path.",
          });
        }
        const bytes = yield* fileSystem.readFile(filePath).pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation: "generateBranchName",
                detail: "Could not read image attachment.",
                cause,
              }),
          ),
        );
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: attachment.mimeType,
            data: Buffer.from(bytes).toString("base64"),
          },
        });
      }
      return blocks;
    });

  const runJson = <S extends Schema.Top & { readonly DecodingServices: never }>(input: {
    readonly operation: TextGenerationOperation;
    readonly prompt: string;
    readonly schema: S;
    readonly model: string | undefined;
    readonly binaryPath: string | undefined;
    readonly fastMode?: boolean;
    readonly imageBlocks?: ReadonlyArray<ClaudeContentBlock>;
  }): Effect.Effect<S["Type"], TextGenerationError> =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* fileSystem
          .makeTempDirectoryScoped({ prefix: "glade-git-writing-" })
          .pipe(
            Effect.mapError(
              (cause) =>
                new TextGenerationError({
                  operation: input.operation,
                  detail: "Could not create an isolated generation directory.",
                  cause,
                }),
            ),
          );
        const abortController = new AbortController();
        let process: ClaudeOwnedProcess | undefined;
        const request = Effect.tryPromise({
          try: async () => {
            const { query } = await loadClaudeAgentSdk();
            const content: ClaudeContentBlock[] = [
              { type: "text", text: input.prompt },
              ...(input.imageBlocks ?? []),
            ];
            const prompt = input.imageBlocks?.length
              ? (async function* (): AsyncGenerator<SDKUserMessage> {
                  yield {
                    type: "user",
                    parent_tool_use_id: null,
                    message: { role: "user", content },
                  };
                })()
              : input.prompt;
            const runtime = query({
              prompt,
              options: {
                cwd,
                ...(input.model ? { model: input.model } : {}),
                pathToClaudeCodeExecutable: input.binaryPath ?? "claude",
                env: buildClaudeProcessEnv(),
                persistSession: false,
                settingSources: [],
                tools: [],
                mcpServers: {},
                extraArgs: { "strict-mcp-config": null, "disable-slash-commands": null },
                plugins: [],
                skills: [],
                permissionMode: "dontAsk",
                canUseTool: async () => ({
                  behavior: "deny",
                  message: "Git writing cannot execute tools.",
                }),
                systemPrompt: GIT_WRITING_INSTRUCTIONS,
                thinking: { type: "disabled" },
                ...(input.fastMode ? { settings: { fastMode: true } } : {}),
                maxTurns: 1,
                abortController,
                outputFormat: {
                  type: "json_schema",
                  schema: toJsonSchemaObject(input.schema) as Record<string, unknown>,
                },
                spawnClaudeCodeProcess: (spawnOptions) => {
                  process = spawnOwnedClaudeCodeProcess(spawnOptions);
                  return process;
                },
              },
            });
            for await (const message of runtime) {
              if (message.type !== "result") continue;
              if (message.subtype !== "success" || message.is_error) {
                const detail =
                  message.subtype === "success"
                    ? redactDiagnosticText(message.result).slice(0, 1000)
                    : message.errors
                        .map((error) => redactDiagnosticText(error))
                        .join("; ")
                        .slice(0, 1000);
                throw new Error(
                  message.subtype === "success"
                    ? `Claude request failed: ${detail}`
                    : `Claude request failed (${message.subtype}): ${detail}`,
                );
              }
              return Schema.decodeUnknownSync(input.schema)(message.structured_output);
            }
            throw new Error("Claude returned no structured output.");
          },
          catch: (cause) =>
            new TextGenerationError({
              operation: input.operation,
              detail:
                cause instanceof Error
                  ? redactDiagnosticText(cause.message).slice(0, 1000)
                  : "Claude text generation failed.",
              cause,
            }),
        });
        return yield* request.pipe(
          Effect.timeoutOrElse({
            duration: CLAUDE_TIMEOUT_MS,
            onTimeout: () =>
              Effect.fail(
                new TextGenerationError({
                  operation: `${input.operation}.timeout`,
                  detail: "Claude text generation timed out.",
                }),
              ),
          }),
          Effect.ensuring(
            Effect.gen(function* () {
              abortController.abort();
              if (process) yield* Effect.promise(() => teardownChildProcessTree(process!));
            }),
          ),
        );
      }),
    );

  return makeStructuredTextGeneration((request) =>
    ("attachments" in request.input ? readImages(request.input) : Effect.succeed([])).pipe(
      Effect.flatMap((imageBlocks) =>
        runJson({
          operation: request.operation,
          prompt: request.prompt,
          schema: request.schema,
          model: request.input.model,
          binaryPath: request.input.providerOptions?.claudeAgent?.binaryPath,
          ...(claudeModelOptions(request.input.modelSelection).fastMode ? { fastMode: true } : {}),
          imageBlocks,
        }),
      ),
    ),
  );
});

export const ClaudeTextGenerationServiceLive = Layer.effect(
  ClaudeTextGeneration,
  makeClaudeTextGeneration,
);
