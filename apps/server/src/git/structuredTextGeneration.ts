import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@glade/shared/git/git";
import { Effect, type Schema } from "effect";

import { TextGenerationError } from "./Errors";
import type {
  BranchNameGenerationInput,
  CommitMessageGenerationInput,
  DiffSummaryGenerationInput,
  PrContentGenerationInput,
  TextGenerationOperation,
  TextGenerationShape,
} from "./Services/TextGeneration";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildDiffSummaryPrompt,
  buildPrContentPrompt,
  sanitizeCommitSubject,
  sanitizeDiffSummary,
  sanitizePrTitle,
} from "./textGenerationShared";

type StructuredGenerationInput =
  | CommitMessageGenerationInput
  | PrContentGenerationInput
  | DiffSummaryGenerationInput
  | BranchNameGenerationInput;

// Runs one structured request; `input` is the operation's own input, for the model, provider
// options and any attachments the provider can send.
export type StructuredGenerationRun = <
  S extends Schema.Top & { readonly DecodingServices: never },
>(request: {
  readonly operation: TextGenerationOperation;
  readonly prompt: string;
  readonly schema: S;
  readonly input: StructuredGenerationInput;
}) => Effect.Effect<S["Type"], TextGenerationError>;

// The Git writing operations shared by every provider that answers a structured request.
export function makeStructuredTextGeneration(run: StructuredGenerationRun): TextGenerationShape {
  return {
    generateCommitMessage: (input) => {
      const { prompt, outputSchemaJson } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
      });
      return run({
        operation: "generateCommitMessage",
        prompt,
        schema: outputSchemaJson,
        input,
      }).pipe(
        Effect.flatMap((generated) =>
          generated.subject.trim()
            ? Effect.succeed(generated)
            : Effect.fail(
                new TextGenerationError({
                  operation: "generateCommitMessage",
                  detail: "Invalid structured output: empty commit subject.",
                }),
              ),
        ),
        Effect.map((generated) => ({
          subject: sanitizeCommitSubject(generated.subject),
          body: generated.body.trim(),
          ...("branch" in generated && typeof generated.branch === "string"
            ? { branch: sanitizeFeatureBranchName(generated.branch) }
            : {}),
        })),
      );
    },
    generatePrContent: (input) => {
      const { prompt, outputSchemaJson } = buildPrContentPrompt(input);
      return run({ operation: "generatePrContent", prompt, schema: outputSchemaJson, input }).pipe(
        Effect.map((generated) => ({
          title: sanitizePrTitle(generated.title),
          body: generated.body.trim(),
        })),
      );
    },
    generateDiffSummary: (input) => {
      const { prompt, outputSchemaJson } = buildDiffSummaryPrompt(input);
      return run({
        operation: "generateDiffSummary",
        prompt,
        schema: outputSchemaJson,
        input,
      }).pipe(Effect.map((generated) => ({ summary: sanitizeDiffSummary(generated.summary) })));
    },
    generateBranchName: (input) => {
      const { prompt, outputSchemaJson } = buildBranchNamePrompt({
        message: input.message,
        ...(input.attachments ? { attachments: input.attachments } : {}),
      });
      return run({ operation: "generateBranchName", prompt, schema: outputSchemaJson, input }).pipe(
        Effect.map((generated) => ({ branch: sanitizeBranchFragment(generated.branch) })),
      );
    },
  };
}
