import { Effect, Schema } from "effect";

import { runProcess } from "../../../platform/processRunner.ts";
import { ProviderAdapterRequestError, type ProviderAdapterError } from "../../core/Errors.ts";
import type { ProviderTitleGeneration } from "../../Services/ProviderAdapter.ts";
import { buildClaudeProcessEnv } from "../claudeProcessEnv.ts";

const PROVIDER = "claudeAgent";

const ClaudePrintResult = Schema.Struct({
  structured_output: Schema.optional(Schema.Unknown),
  is_error: Schema.optional(Schema.Boolean),
  errors: Schema.optional(Schema.Array(Schema.String)),
  result: Schema.optional(Schema.String),
});

const requestError = (detail: string, cause?: unknown) =>
  new ProviderAdapterRequestError({
    provider: PROVIDER,
    method: "generateThreadTitle",
    detail,
    ...(cause === undefined ? {} : { cause }),
  });

// One `claude --print` run with every user and project source disabled, so a title request cannot
// load tools, MCP servers, hooks, memory or session history.
export const claudeTitleGeneration: ProviderTitleGeneration<ProviderAdapterError> = {
  preferredModel: "claude-sonnet-5-5",
  generate: (input) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: (signal) =>
          runProcess(
            input.binaryPath ?? "claude",
            [
              "--print",
              "--output-format",
              "json",
              "--model",
              input.model,
              ...(input.effort ? ["--effort", input.effort] : []),
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
              input.instructions,
              "--json-schema",
              JSON.stringify(input.outputSchema),
            ],
            {
              cwd: input.cwd,
              stdin: input.prompt,
              env: buildClaudeProcessEnv(),
              signal,
              allowNonZeroExit: true,
              timeoutMs: 45_000,
              maxBufferBytes: 256_000,
            },
          ),
        catch: (cause) =>
          requestError(
            cause instanceof Error ? cause.message : "Claude title generation failed.",
            cause,
          ),
      });
      if (!result.stdout.trim())
        return yield* requestError(result.stderr.trim() || "Claude title generation failed.");
      const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ClaudePrintResult))(
        result.stdout,
      ).pipe(
        Effect.mapError((cause) => requestError("Claude did not return a valid title.", cause)),
      );
      if (result.code !== 0 || decoded.is_error || decoded.structured_output === undefined)
        return yield* requestError(
          decoded.errors?.join("\n") ||
            decoded.result ||
            result.stderr.trim() ||
            "Claude did not return a title.",
        );
      return decoded.structured_output;
    }),
};
