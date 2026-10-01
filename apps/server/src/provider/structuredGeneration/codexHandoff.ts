import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { parse } from "toml";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { resolveApiModelId } from "@glade/shared/provider/model";
import { HandoffRecord } from "@glade/contracts/orchestration/threadEntities";
import { makeEffectProcessCommand } from "../../platform/effectProcessRuntime";
import { buildCodexProcessEnv } from "../codex/codexProcessEnv";
import { resolveBaseCodexHomePath } from "../codex/codexHomePaths";
import { ProviderValidationError } from "../core/Errors";
import type { HandoffGenerationInput } from "../Services/HandoffGeneration";

function tomlValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(",")}]`;
  const entries = Object.entries(asRecord(value) ?? {});
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}=${tomlValue(item)}`).join(",")}}`;
}

// Copy authentication routing only. Workspace config, MCP, hooks, plugins and instructions must
// never enter an isolated preparation request, even when the user's regular runtime enables them.
function authenticationConfig(content: string): string {
  const config = asRecord(parse(content)) ?? {};
  const profiles = asRecord(config.profiles);
  const profile =
    typeof config.profile === "string" ? asRecord(profiles?.[config.profile]) : undefined;
  const effective = { ...config, ...profile };
  const routing = [
    "model_provider",
    "cli_auth_credentials_store",
    "chatgpt_base_url",
    "forced_login_method",
    "forced_chatgpt_workspace_id",
  ]
    .filter((key) => effective[key] !== undefined)
    .map((key) => `${key}=${tomlValue(effective[key])}`);
  const providers = asRecord(effective.model_providers) ?? {};
  for (const [name, provider] of Object.entries(providers)) {
    routing.push(`[model_providers.${JSON.stringify(name)}]`);
    for (const [key, value] of Object.entries(asRecord(provider) ?? {}))
      routing.push(
        `${/^[a-z_][a-z0-9_]*$/i.test(key) ? key : JSON.stringify(key)}=${tomlValue(value)}`,
      );
  }
  return routing.join("\n");
}

export const generateCodexHandoff = Effect.fnUntraced(function* (input: HandoffGenerationInput) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "glade-handoff-" });
  const home = path.join(root, "codex");
  const cwd = path.join(root, "workspace");
  yield* fs.makeDirectory(home);
  yield* fs.makeDirectory(cwd);
  const sourceHome = resolveBaseCodexHomePath(process.env, input.providerOptions.codex?.homePath);
  for (const name of ["auth.json", "config.toml"]) {
    const exists = yield* fs.exists(path.join(sourceHome, name));
    if (!exists) continue;
    const content = yield* fs.readFileString(path.join(sourceHome, name));
    const target = path.join(home, name);
    const isolatedContent =
      name === "config.toml"
        ? yield* Effect.try({
            try: () => authenticationConfig(content),
            catch: (cause) =>
              new ProviderValidationError({
                operation: "handoff.prepare",
                issue: "Destination Codex authentication configuration could not be loaded.",
                cause,
              }),
          })
        : content;
    yield* fs.writeFileString(target, isolatedContent);
    yield* fs.chmod(target, 0o600);
  }
  const schemaPath = path.join(root, "schema.json");
  const outputPath = path.join(root, "output.json");
  const schema = Schema.toJsonSchemaDocument(HandoffRecord);
  yield* fs.writeFileString(
    schemaPath,
    JSON.stringify({ ...schema.schema, $defs: schema.definitions }),
  );
  const selection = input.modelSelection;
  const options = selection.provider === "codex" ? selection.options : undefined;
  const config = {
    approval_policy: "never",
    web_search: "disabled",
    "features.shell_tool": false,
    "features.unified_exec": false,
    "features.apps": false,
    "features.hooks": false,
    "features.browser_use": false,
    "features.computer_use": false,
    "features.image_generation": false,
    "features.multi_agent": false,
    "features.code_mode": false,
    "features.code_mode_host": false,
    "features.js_repl": false,
    "features.skills": false,
    ...(options?.reasoningEffort ? { model_reasoning_effort: options.reasoningEffort } : {}),
    ...(options?.serviceTier || options?.fastMode
      ? { service_tier: options.serviceTier ?? "fast" }
      : {}),
  };
  const env = yield* Effect.promise(() => buildCodexProcessEnv({ homePath: home }));
  const child = yield* spawner.spawn(
    makeEffectProcessCommand(
      input.providerOptions.codex?.binaryPath || "codex",
      [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--json",
        "-s",
        "read-only",
        ...(resolveApiModelId(selection) ? ["--model", resolveApiModelId(selection)!] : []),
        ...Object.entries(config).flatMap(([key, value]) => ["-c", `${key}=${tomlValue(value)}`]),
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-",
      ],
      { cwd, env, stdin: { stream: Stream.make(new TextEncoder().encode(input.prompt)) } },
    ),
  );
  let usage: { input_tokens: number; output_tokens: number } | undefined;
  yield* Effect.all(
    [
      child.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) =>
          Effect.sync(() => {
            const decoded = Schema.decodeUnknownOption(
              Schema.fromJsonString(
                Schema.Struct({
                  type: Schema.String,
                  usage: Schema.optional(
                    Schema.Struct({ input_tokens: Schema.Number, output_tokens: Schema.Number }),
                  ),
                }),
              ),
            )(line);
            if (decoded._tag === "Some" && decoded.value.type === "turn.completed")
              usage = decoded.value.usage;
          }),
        ),
      ),
      Stream.runDrain(child.stderr),
    ],
    { concurrency: "unbounded" },
  );
  const exit = yield* child.exitCode;
  if (Number(exit) !== 0) {
    return yield* new ProviderValidationError({
      operation: "handoff.prepare",
      issue: `Destination Codex preparation failed (exit ${exit}). Check destination authentication/quota and retry; the source and draft are intact.`,
    });
  }
  const record = yield* fs
    .readFileString(outputPath)
    .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(HandoffRecord))));
  return {
    record,
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
  };
});
