import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { Effect, FileSystem, Schema } from "effect";

import type { ProviderAdapterError } from "../provider/core/Errors";
import type { ProviderStructuredRequestInput } from "../provider/Services/ProviderAdapter";
import { TextGenerationError } from "./Errors";
import type { TextGenerationShape } from "./Services/TextGeneration";
import { makeStructuredTextGeneration } from "./structuredTextGeneration";
import { GIT_WRITING_INSTRUCTIONS, toJsonSchemaObject } from "./textGenerationShared";

const REQUEST_TIMEOUT_MS = 180_000;

// Git writing for a provider whose adapter answers one-shot structured requests. Each request runs
// in an empty temporary directory, so the agent sees only the evidence in the prompt.
export function makeAdapterTextGeneration(input: {
  readonly provider: ProviderKind;
  readonly fileSystem: FileSystem.FileSystem;
  readonly structuredRequest: (
    request: ProviderStructuredRequestInput,
  ) => Effect.Effect<unknown, ProviderAdapterError>;
}): TextGenerationShape {
  return makeStructuredTextGeneration((request) =>
    Effect.scoped(
      Effect.gen(function* () {
        const failure = (detail: string, cause?: unknown) =>
          new TextGenerationError({
            operation: request.operation,
            detail,
            ...(cause === undefined ? {} : { cause }),
          });
        const cwd = yield* input.fileSystem
          .makeTempDirectoryScoped({ prefix: "glade-git-writing-" })
          .pipe(
            Effect.mapError((cause) =>
              failure("Could not create an isolated generation directory.", cause),
            ),
          );
        const effort = request.input.modelSelection?.options?.effort;
        const binaryPath = request.input.providerOptions?.[input.provider]?.binaryPath;
        const raw = yield* input
          .structuredRequest({
            cwd,
            ...(request.input.model ? { model: request.input.model } : {}),
            ...(typeof effort === "string" ? { effort } : {}),
            ...(binaryPath ? { binaryPath } : {}),
            instructions: GIT_WRITING_INSTRUCTIONS,
            prompt: request.prompt,
            outputSchema: toJsonSchemaObject(request.schema),
          })
          .pipe(Effect.mapError((cause) => failure(cause.message, cause)));
        return yield* Schema.decodeUnknownEffect(request.schema)(raw).pipe(
          Effect.mapError((cause) => failure("Invalid structured output.", cause)),
        );
      }),
    ).pipe(
      Effect.timeoutOrElse({
        duration: REQUEST_TIMEOUT_MS,
        onTimeout: () =>
          Effect.fail(
            new TextGenerationError({
              operation: `${request.operation}.timeout`,
              detail: "Git text generation timed out.",
            }),
          ),
      }),
    ),
  );
}
