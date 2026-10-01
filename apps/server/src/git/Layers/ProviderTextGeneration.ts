import { normalizeModelSlug } from "@glade/shared/provider/model";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import {
  type ProviderStartOptions,
  type ModelSelection,
} from "@glade/contracts/provider/sessionPolicy";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { Effect, Layer } from "effect";

import { providerDisabledSettingsMessage } from "../../provider/core/enabledProviderAdapter.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { TextGenerationError } from "../Errors.ts";
import * as TextGen from "../Services/TextGeneration.ts";
import * as Selection from "../textGenerationSelection.ts";
import { ProviderDiscoveryService } from "../../provider/Services/ProviderDiscoveryService.ts";

const makeProviderTextGeneration = Effect.gen(function* () {
  const codexTextGeneration = yield* TextGen.CodexTextGeneration;
  const serverSettings = yield* ServerSettingsService;
  const discovery = yield* ProviderDiscoveryService;

  const prepareCommitInput = (input: TextGen.CommitMessageGenerationInput) =>
    Effect.gen(function* () {
      const provider = input.modelSelection?.provider ?? "codex";
      const model = input.modelSelection?.model ?? input.model;
      const startup = input.providerOptions?.[provider];
      const catalog = yield* discovery
        .listModels({
          provider,
          cwd: input.cwd,
          ...(startup?.binaryPath ? { binaryPath: startup.binaryPath } : {}),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation: "generateCommitMessage",
                detail: "Could not read commit model capabilities.",
                cause,
              }),
          ),
        );
      const selectedModel =
        normalizeModelSlug(model, provider) ??
        catalog.models.find((entry) => entry.isDefault)?.slug;
      if (!selectedModel)
        return yield* new TextGenerationError({
          operation: "generateCommitMessage",
          detail: "Provider discovery did not return a default model.",
        });
      const descriptor = catalog.models.find(
        (entry) => entry.slug === selectedModel || entry.resolvedModel === selectedModel,
      );
      const efforts = descriptor?.supportedReasoningEfforts?.map((effort) => effort.value) ?? [];
      const effortOrder = [
        "none",
        "off",
        "disabled",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra",
      ];
      const reasoningEffort = effortOrder.find((effort) => efforts.includes(effort)) ?? efforts[0];
      const options = {
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(descriptor?.supportsFastMode ? { fastMode: true } : {}),
      };
      const modelSelection: ModelSelection = { provider: "codex", model: selectedModel, options };
      return { ...input, model: selectedModel, modelSelection };
    });

  const resolveRequestedProvider = (input: {
    readonly model?: string;
    readonly modelSelection?: ModelSelection;
  }): ProviderKind => input.modelSelection?.provider ?? "codex";

  const implementations = {
    codex: codexTextGeneration,
  } satisfies Record<Selection.GitTextGenerationProvider, TextGen.TextGenerationShape>;

  const resolveImplementation = (
    operation: string,
    input: {
      readonly model?: string;
      readonly modelSelection?: ModelSelection;
    },
  ) =>
    Effect.gen(function* () {
      const requestedProvider = resolveRequestedProvider(input);
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation,
              detail: "Failed to read provider enablement settings.",
              cause,
            }),
        ),
      );
      const fallbackModelSelection = Selection.hasDedicatedTextGenerationProvider(requestedProvider)
        ? undefined
        : settings.textGenerationModelSelection;
      const provider = fallbackModelSelection?.provider ?? requestedProvider;
      if (!Selection.hasDedicatedTextGenerationProvider(provider)) {
        return yield* Effect.fail(
          new TextGenerationError({
            operation,
            detail: `${PROVIDER_DISPLAY_NAMES[requestedProvider]} does not support Git text generation, and no supported fallback is enabled.`,
          }),
        );
      }
      if (!settings.providers[provider].enabled) {
        return yield* Effect.fail(
          new TextGenerationError({ operation, detail: providerDisabledSettingsMessage(provider) }),
        );
      }
      return {
        implementation: implementations[provider],
        fallbackModelSelection,
      };
    });

  const call = <
    Input extends {
      readonly cwd: string;
      readonly model?: string;
      readonly modelSelection?: ModelSelection;
      readonly providerOptions?: ProviderStartOptions;
    },
    Output,
  >(
    operation: string,
    input: Input,
    run: (
      implementation: TextGen.TextGenerationShape,
      input: Input,
    ) => Effect.Effect<Output, TextGenerationError>,
  ) =>
    resolveImplementation(operation, input).pipe(
      Effect.flatMap(({ implementation, fallbackModelSelection }) =>
        Effect.gen(function* () {
          let selection = fallbackModelSelection ??
            input.modelSelection ?? { provider: "codex" as const, model: input.model ?? "" };
          if (!normalizeModelSlug(selection.model, selection.provider)) {
            const catalog = yield* discovery
              .listModels({
                provider: selection.provider,
                cwd: input.cwd,
                ...(input.providerOptions?.[selection.provider]?.binaryPath
                  ? { binaryPath: input.providerOptions[selection.provider]!.binaryPath! }
                  : {}),
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new TextGenerationError({
                      operation,
                      detail: "Could not read the provider's default model.",
                      cause,
                    }),
                ),
              );
            const model = catalog.models.find((entry) => entry.isDefault)?.slug;
            if (!model)
              return yield* new TextGenerationError({
                operation,
                detail: catalog.error ?? "Provider did not return a default model.",
              });
            selection = { ...selection, model };
          }
          return yield* run(implementation, {
            ...input,
            model: selection.model,
            modelSelection: selection,
          });
        }),
      ),
    );

  return {
    generateCommitMessage: (input: TextGen.CommitMessageGenerationInput) =>
      call("generateCommitMessage", input, (impl, value) =>
        prepareCommitInput(value).pipe(
          Effect.flatMap((prepared) => impl.generateCommitMessage(prepared)),
        ),
      ).pipe(
        Effect.timeoutOrElse({
          duration: 90_000,
          onTimeout: () =>
            Effect.fail(
              new TextGenerationError({
                operation: "generateCommitMessage",
                detail: "Commit message generation timed out after 90 seconds. Try again.",
              }),
            ),
        }),
      ),
    generatePrContent: (input: TextGen.PrContentGenerationInput) =>
      call("generatePrContent", input, (impl, value) => impl.generatePrContent(value)),
    generateDiffSummary: (input: TextGen.DiffSummaryGenerationInput) =>
      call("generateDiffSummary", input, (impl, value) => impl.generateDiffSummary(value)),
    generateBranchName: (input: TextGen.BranchNameGenerationInput) =>
      call("generateBranchName", input, (impl, value) => impl.generateBranchName(value)),
    generateAutomationIntent: (input: TextGen.AutomationIntentGenerationInput) =>
      call("generateAutomationIntent", input, (impl, value) =>
        impl.generateAutomationIntent(value),
      ),
    evaluateAutomationCompletion: (input: TextGen.AutomationCompletionEvaluationInput) =>
      call("evaluateAutomationCompletion", input, (impl, value) =>
        impl.evaluateAutomationCompletion(value),
      ),
  } satisfies TextGen.TextGenerationShape;
});

export const ProviderTextGenerationLive = Layer.effect(
  TextGen.TextGeneration,
  makeProviderTextGeneration,
);
