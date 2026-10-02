import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { parse } from "toml";
import { TextGenerationError } from "./Errors";

const ModelCache = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      slug: Schema.String,
      context_window: Schema.Number,
      effective_context_window_percent: Schema.optional(Schema.Number),
    }),
  ),
});

// A UTF-8 byte is a conservative upper bound for byte-level tokenizers. Reserve
// extra room for Codex's wrapper/schema as well as the structured answer.
export function fitGenerationBudget(input: {
  home: string;
  model: string | undefined;
  prompt: string;
  operation: "generateCommitMessage" | "generatePrContent";
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const readOptional = (file: string) =>
      fs.readFileString(path.join(input.home, file)).pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(null)
            : Effect.fail(
                new TextGenerationError({
                  operation: `${input.operation}.model-discovery`,
                  detail: "Could not read the model context budget. Check Codex configuration.",
                  cause: error,
                }),
              ),
        ),
      );
    const configText = yield* readOptional("config.toml");
    const config =
      configText === null
        ? {}
        : yield* Effect.try({
            try: () => parse(configText) as Record<string, unknown>,
            catch: (cause) =>
              new TextGenerationError({
                operation: `${input.operation}.model-discovery`,
                detail: "Codex configuration is invalid. Correct it before generation.",
                cause,
              }),
          });
    const model = input.model ?? (typeof config.model === "string" ? config.model : undefined);
    let contextWindow =
      typeof config.model_context_window === "number" ? config.model_context_window : undefined;
    const cacheText = yield* readOptional("models_cache.json");
    if (cacheText !== null) {
      const cache = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(ModelCache)(JSON.parse(cacheText)),
        catch: (cause) =>
          new TextGenerationError({
            operation: `${input.operation}.model-discovery`,
            detail: "Codex model catalog is invalid. Refresh provider discovery and retry.",
            cause,
          }),
      });
      const descriptor = cache.models.find((entry) => entry.slug === model);
      if (descriptor) {
        const effective = Math.floor(
          (descriptor.context_window *
            Math.min(100, descriptor.effective_context_window_percent ?? 100)) /
            100,
        );
        contextWindow = Math.min(contextWindow ?? effective, effective);
      }
    }
    if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 20_480)
      return yield* new TextGenerationError({
        operation: `${input.operation}.model-discovery`,
        detail:
          "Could not establish a usable context window for the selected model. Refresh Codex model discovery or configure model_context_window and retry.",
      });
    const promptBudget = Math.min(
      input.operation === "generateCommitMessage" ? 32_000 : 48_000,
      Math.floor(contextWindow) - 16_384 - 4096,
    );
    const bytes = Buffer.from(input.prompt);
    const marker = "\n[remaining evidence omitted to fit the selected model]";
    let end = Math.min(bytes.length, promptBudget - Buffer.byteLength(marker));
    while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
    return {
      prompt:
        bytes.length <= promptBudget
          ? input.prompt
          : bytes.subarray(0, end).toString("utf8") + marker,
      contextWindow,
      promptBudget,
    };
  });
}
