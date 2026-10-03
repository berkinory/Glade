import { ServerSettingsService } from "../../settings/serverSettings";
import { providerStartOptionsFromServerSettings } from "../../settings/settingsPatches";
import { toJsonSchemaObject } from "../../git/textGenerationShared";
import { Effect, FileSystem, Layer, Schema, Semaphore } from "effect";
import type { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { ThreadTitleGeneration } from "../Services/ThreadTitleGeneration";
import type { ThreadTitleGenerationInput } from "../Services/ThreadTitleGeneration";
import { CodexAdapter } from "../../provider/Services/CodexAdapter";
import { TextGenerationError } from "../../git/Errors";
import {
  buildThreadTitlePrompt,
  ThreadTitleOutput,
  normalizeGeneratedThreadTitle,
  THREAD_TITLE_INSTRUCTIONS,
} from "../threadTitlePrompt";
import { ProviderDiscoveryService } from "../../provider/Services/ProviderDiscoveryService";
import { buildClaudeProcessEnv } from "../../provider/claude/claudeProcessEnv";
import { runProcess } from "../../platform/processRunner";

const make = Effect.gen(function* () {
  const codex = yield* CodexAdapter;
  const discovery = yield* ProviderDiscoveryService;
  const fs = yield* FileSystem.FileSystem;
  const settings = yield* ServerSettingsService;
  const titleSlot = yield* Semaphore.make(1);

  const generate = (input: ThreadTitleGenerationInput) =>
    Effect.gen(function* () {
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "glade-thread-title-" }).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateThreadTitle",
              detail: "Could not create title generation directory.",
              cause,
            }),
        ),
      );
      const provider = input.modelSelection.provider;
      const defaults = yield* settings.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateThreadTitle",
              detail: "Could not read provider configuration.",
              cause,
            }),
        ),
        Effect.map(providerStartOptionsFromServerSettings),
      );
      const providerOptions = {
        codex: { ...defaults.codex, ...input.providerOptions?.codex },
        claudeAgent: { ...defaults.claudeAgent, ...input.providerOptions?.claudeAgent },
      };
      const startup = providerOptions[provider];
      const catalog = yield* discovery
        .listModels({
          provider,
          ...(startup?.binaryPath ? { binaryPath: startup.binaryPath } : {}),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation: "generateThreadTitle",
                detail: "Could not read title model capabilities.",
                cause,
              }),
          ),
        );
      if (catalog.source === "disabled")
        return yield* new TextGenerationError({
          operation: "generateThreadTitle",
          detail: "Title provider is disabled in Settings.",
        });
      const preferredModel = provider === "codex" ? "gpt-6-luna" : "claude-sonnet-5-5";
      const select = (model: string): ModelSelection => {
        const descriptor = catalog.models.find(
          (entry) => entry.slug === model || entry.resolvedModel === model,
        );
        const effortOption = descriptor?.optionDescriptors?.find(
          (option) => option.id === "effort",
        );
        const efforts =
          descriptor?.supportedReasoningEfforts?.map((entry) => entry.value) ??
          (effortOption?.type === "select" ? effortOption.options.map((option) => option.id) : []);
        const effort = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].find((value) =>
          efforts.includes(value),
        );
        return provider === "codex"
          ? { provider, model, ...(effort ? { options: { reasoningEffort: effort } } : {}) }
          : { provider, model, ...(effort ? { options: { effort } } : {}) };
      };
      const attempt = (selection: ModelSelection) => {
        if (selection.provider === "codex")
          return codex
            .generateThreadTitle({
              threadId: input.threadId,
              cwd,
              model: selection.model,
              ...(selection.options?.reasoningEffort
                ? { effort: selection.options.reasoningEffort }
                : {}),
              instructions: THREAD_TITLE_INSTRUCTIONS,
              prompt: buildThreadTitlePrompt(input.message),
              outputSchema: toJsonSchemaObject(ThreadTitleOutput),
            })
            .pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ThreadTitleOutput))),
              Effect.map((result) => result.title),
              Effect.mapError(
                (cause) =>
                  new TextGenerationError({
                    operation: "generateThreadTitle",
                    detail: cause.message,
                    cause,
                  }),
              ),
            );
        return Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: (signal) =>
              runProcess(
                startup?.binaryPath ?? "claude",
                [
                  "--print",
                  "--output-format",
                  "json",
                  "--model",
                  selection.model,
                  ...(selection.options?.effort ? ["--effort", selection.options.effort] : []),
                  "--tools",
                  "",
                  "--disable-slash-commands",
                  "--strict-mcp-config",
                  "--mcp-config",
                  '{"mcpServers":{}}',
                  "--setting-sources",
                  "",
                  "--settings",
                  '{"disableAllHooks":true,"claudeMdExcludes":["**/*"]}',
                  "--no-session-persistence",
                  "--system-prompt",
                  THREAD_TITLE_INSTRUCTIONS,
                  "--json-schema",
                  JSON.stringify(toJsonSchemaObject(ThreadTitleOutput)),
                ],
                {
                  cwd,
                  stdin: buildThreadTitlePrompt(input.message),
                  env: buildClaudeProcessEnv(),
                  signal,
                  allowNonZeroExit: true,
                  timeoutMs: 45_000,
                  maxBufferBytes: 256_000,
                },
              ),
            catch: (cause) =>
              new TextGenerationError({
                operation: "generateThreadTitle",
                detail: cause instanceof Error ? cause.message : "Claude title generation failed.",
                cause,
              }),
          });
          if (!result.stdout.trim())
            return yield* new TextGenerationError({
              operation: "generateThreadTitle",
              detail: result.stderr.trim() || "Claude title generation failed.",
            });
          const decoded = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(
              Schema.Struct({
                structured_output: Schema.optional(ThreadTitleOutput),
                is_error: Schema.optional(Schema.Boolean),
                errors: Schema.optional(Schema.Array(Schema.String)),
                result: Schema.optional(Schema.String),
              }),
            ),
          )(result.stdout).pipe(
            Effect.mapError(
              (cause) =>
                new TextGenerationError({
                  operation: "generateThreadTitle",
                  detail: "Claude did not return a valid title.",
                  cause,
                }),
            ),
          );
          if (result.code !== 0 || decoded.is_error || !decoded.structured_output)
            return yield* new TextGenerationError({
              operation: "generateThreadTitle",
              detail:
                decoded.errors?.join("\n") ||
                decoded.result ||
                result.stderr.trim() ||
                "Claude did not return a title.",
            });
          return decoded.structured_output.title;
        });
      };
      const preferredAvailable = catalog.models.some(
        (entry) => entry.slug === preferredModel || entry.resolvedModel === preferredModel,
      );
      const selectedModel = preferredAvailable ? preferredModel : input.modelSelection.model;
      const raw = yield* attempt(select(selectedModel)).pipe(
        Effect.catch((error) => {
          const unavailable =
            /(?:unrecognized_model|model_not_found|invalid_model|model[^\n]*(?:not found|not available|not supported|unavailable|does not exist|access|permission)|(?:access|permission)[^\n]*model)/i.test(
              error.detail,
            );
          return selectedModel !== input.modelSelection.model && unavailable
            ? attempt(select(input.modelSelection.model))
            : Effect.fail(error);
        }),
      );
      const title = normalizeGeneratedThreadTitle(raw);
      if (!title)
        return yield* new TextGenerationError({
          operation: "generateThreadTitle",
          detail: "Provider returned an empty title.",
        });
      return title;
    }).pipe(Effect.scoped, titleSlot.withPermits(1));
  return { generate };
});

export const ThreadTitleGenerationLive = Layer.effect(ThreadTitleGeneration, make);
