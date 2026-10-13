import { ServerSettingsService } from "../../settings/serverSettings";
import { providerStartOptionsFromServerSettings } from "../../settings/settingsPatches";
import { toJsonSchemaObject } from "../../git/textGenerationShared";
import { Effect, FileSystem, Layer, Schema, Semaphore } from "effect";
import { ThreadTitleGeneration } from "../Services/ThreadTitleGeneration";
import type { ThreadTitleGenerationInput } from "../Services/ThreadTitleGeneration";
import { ProviderAdapterRegistry } from "../../provider/Services/ProviderAdapterRegistry";
import { TextGenerationError } from "../../git/Errors";
import {
  buildThreadTitlePrompt,
  ThreadTitleOutput,
  normalizeGeneratedThreadTitle,
  THREAD_TITLE_INSTRUCTIONS,
} from "../threadTitlePrompt";
import { ProviderDiscoveryService } from "../../provider/Services/ProviderDiscoveryService";

const make = Effect.gen(function* () {
  const registry = yield* ProviderAdapterRegistry;
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
      const binaryPath =
        input.providerOptions?.[provider]?.binaryPath ?? defaults[provider]?.binaryPath;
      const catalog = yield* discovery
        .listModels({
          provider,
          ...(binaryPath ? { binaryPath } : {}),
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
      const adapter = yield* registry.getByProvider(provider).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateThreadTitle",
              detail: cause.message,
              cause,
            }),
        ),
      );
      const titleGeneration = adapter.titleGeneration;
      if (!titleGeneration)
        return yield* new TextGenerationError({
          operation: "generateThreadTitle",
          detail: "This provider cannot generate conversation titles.",
        });
      const preferredModel = titleGeneration.preferredModel;
      const effortFor = (model: string) => {
        const descriptor = catalog.models.find(
          (entry) => entry.slug === model || entry.resolvedModel === model,
        );
        const effortOption = descriptor?.optionDescriptors?.find(
          (option) => option.id === "effort",
        );
        const efforts =
          descriptor?.supportedReasoningEfforts?.map((entry) => entry.value) ??
          (effortOption?.type === "select" ? effortOption.options.map((option) => option.id) : []);
        return ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].find((value) =>
          efforts.includes(value),
        );
      };
      const attempt = (model: string) => {
        const effort = effortFor(model);
        return titleGeneration
          .generate({
            threadId: input.threadId,
            cwd,
            model,
            ...(effort ? { effort } : {}),
            ...(binaryPath ? { binaryPath } : {}),
            instructions: THREAD_TITLE_INSTRUCTIONS,
            prompt: buildThreadTitlePrompt(input.message),
            outputSchema: toJsonSchemaObject(ThreadTitleOutput),
          })
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(ThreadTitleOutput)),
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
      };
      const preferredAvailable = catalog.models.some(
        (entry) => entry.slug === preferredModel || entry.resolvedModel === preferredModel,
      );
      const selectedModel = preferredAvailable ? preferredModel : input.modelSelection.model;
      const raw = yield* attempt(selectedModel).pipe(
        Effect.catch((error) => {
          const unavailable =
            /(?:unrecognized_model|model_not_found|invalid_model|model[^\n]*(?:not found|not available|not supported|unavailable|does not exist|access|permission)|(?:access|permission)[^\n]*model)/i.test(
              error.detail,
            );
          return selectedModel !== input.modelSelection.model && unavailable
            ? attempt(input.modelSelection.model)
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
