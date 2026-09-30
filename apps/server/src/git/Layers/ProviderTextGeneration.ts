import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  PROVIDER_DISPLAY_NAMES,
} from "@glade/contracts/provider/model";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { Effect, Layer } from "effect";

import { providerDisabledSettingsMessage } from "../../provider/enabledProviderAdapter.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
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
      const model = input.modelSelection?.model ?? input.model ?? DEFAULT_GIT_TEXT_GENERATION_MODEL;
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
      const descriptor = catalog.models.find(
        (entry) => entry.slug === model || entry.resolvedModel === model,
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
      const modelSelection: ModelSelection = { provider: "codex", model, options };
      return { ...input, model, modelSelection };
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
    Input extends { readonly model?: string; readonly modelSelection?: ModelSelection },
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
        run(
          implementation,
          fallbackModelSelection
            ? ({
                ...input,
                model: fallbackModelSelection.model,
                modelSelection: fallbackModelSelection,
              } as Input)
            : input,
        ),
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
    generateThreadTitle: (input: TextGen.ThreadTitleGenerationInput) =>
      call("generateThreadTitle", input, (impl, value) => impl.generateThreadTitle(value)),
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
