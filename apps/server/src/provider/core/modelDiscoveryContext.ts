import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type { ProviderListModelsInput } from "@glade/contracts/provider/providerDiscovery";
import type { ServerSettings } from "@glade/contracts/settings/settings";
import { resolveExecutable } from "@glade/shared/platform/executable";
import { resolveBaseCodexHomePath } from "../codex/codexHomePaths.ts";
import { ProviderAdapterRequestError } from "./Errors.ts";

export const modelDiscoveryContext = (input: {
  readonly request: ProviderListModelsInput;
  readonly settings: ServerSettings;
  readonly homeDir: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      const provider = input.request.provider;
      const settings = input.settings.providers[provider];
      const env = process.env;
      const binary =
        input.request.binaryPath?.trim() ||
        settings.binaryPath?.trim() ||
        (provider === "codex" ? "codex" : "claude");
      const executable = resolveExecutable(binary, {
        env,
        ...(input.request.cwd ? { cwd: input.request.cwd } : {}),
      });
      const home =
        provider === "codex"
          ? resolveBaseCodexHomePath(env, input.settings.providers.codex.homePath)
          : env.CLAUDE_CONFIG_DIR?.trim() ||
            path.join(input.homeDir || env.HOME || homedir(), ".claude");
      const files =
        provider === "codex"
          ? [path.join(home, "auth.json"), path.join(home, "config.toml")]
          : [
              path.join(home, ".credentials.json"),
              path.join(home, "settings.json"),
              path.join(input.homeDir, ".claude.json"),
            ];
      if (executable) files.push(executable);
      if (input.request.cwd) {
        files.push(
          ...(provider === "codex"
            ? [path.join(input.request.cwd, ".codex", "config.toml")]
            : [
                path.join(input.request.cwd, ".claude", "settings.json"),
                path.join(input.request.cwd, ".claude", "settings.local.json"),
              ]),
        );
      }
      const revisions = await Promise.all(
        files.map(async (file) => {
          try {
            const info = await stat(file, { bigint: true });
            return [file, String(info.mtimeNs), String(info.size), String(info.ino)];
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT")
              return [file, "missing"];
            throw error;
          }
        }),
      );
      // Only a digest persists: environment credentials must never appear in catalog keys or logs.
      const identity = createHash("sha256")
        .update(
          JSON.stringify({
            settings,
            executable,
            home,
            revisions,
            environment:
              provider === "codex"
                ? [env.OPENAI_API_KEY, env.OPENAI_BASE_URL, env.CODEX_HOME]
                : [
                    env.ANTHROPIC_API_KEY,
                    env.ANTHROPIC_AUTH_TOKEN,
                    env.CLAUDE_CODE_OAUTH_TOKEN,
                    env.ANTHROPIC_BASE_URL,
                    env.CLAUDE_CODE_USE_BEDROCK,
                    env.CLAUDE_CODE_USE_VERTEX,
                  ],
          }),
        )
        .digest("hex");
      return { identity, binaryPath: executable ?? binary };
    },
    catch: (cause) =>
      new ProviderAdapterRequestError({
        provider: input.request.provider,
        method: "models/list",
        detail: "Could not inspect the provider runtime configuration for model discovery.",
        cause,
      }),
  });
