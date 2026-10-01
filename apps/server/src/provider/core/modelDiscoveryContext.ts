import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Effect, Schema } from "effect";
import type { ProviderListModelsInput } from "@glade/contracts/provider/providerDiscovery";
import type { ServerSettings } from "@glade/contracts/settings/settings";
import { resolveExecutable } from "@glade/shared/platform/executable";
import { resolveBaseCodexHomePath } from "../codex/codexHomePaths.ts";
import { ProviderAdapterRequestError } from "./Errors.ts";

async function readNativeIdentityFile(file: string): Promise<Record<string, unknown> | null> {
  try {
    return Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
      JSON.parse(await readFile(file, "utf8")),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    // JSON and schema errors can quote authentication file contents.
    throw new Error("Malformed provider authentication metadata.", { cause: error });
  }
}

async function nativeAccountIdentity(
  provider: ProviderListModelsInput["provider"],
  home: string,
  homeDir: string,
) {
  if (provider === "codex") {
    const auth = await readNativeIdentityFile(path.join(home, "auth.json"));
    const tokens = auth?.tokens;
    return {
      mode: auth?.auth_mode,
      apiKey: auth?.OPENAI_API_KEY,
      account:
        typeof tokens === "object" && tokens !== null && "account_id" in tokens
          ? tokens.account_id
          : tokens,
    };
  }
  const config = await readNativeIdentityFile(path.join(homeDir, ".claude.json"));
  const account = config?.oauthAccount;
  if (typeof account === "object" && account !== null && "accountUuid" in account) {
    const metadata = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
      account,
    );
    return Object.fromEntries(
      [
        "accountUuid",
        "organizationUuid",
        "seatTier",
        "organizationRateLimitTier",
        "userRateLimitTier",
        "billingType",
      ].map((key) => [key, metadata[key]]),
    );
  }
  return readNativeIdentityFile(path.join(home, ".credentials.json"));
}

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
      const account = await nativeAccountIdentity(provider, home, input.homeDir);
      const files = [path.join(home, provider === "codex" ? "config.toml" : "settings.json")];
      if (executable) files.push(executable);
      const globalFileCount = files.length;
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
      // Native CLIs rewrite token and usage caches during discovery. Only account identity and real
      // settings affect the catalog; credentials remain confined to this digest, never persisted keys.
      const identity = createHash("sha256")
        .update(
          JSON.stringify({
            settings,
            executable,
            home,
            account,
            revisions: revisions.slice(0, globalFileCount),
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
      const workspaceRevisions = revisions.slice(globalFileCount);
      const workspaceIdentity = workspaceRevisions.some((revision) => revision[1] !== "missing")
        ? createHash("sha256").update(JSON.stringify(workspaceRevisions)).digest("hex")
        : null;
      return { identity, workspaceIdentity, binaryPath: executable ?? binary };
    },
    catch: (cause) =>
      new ProviderAdapterRequestError({
        provider: input.request.provider,
        method: "models/list",
        detail: "Could not inspect the provider runtime configuration for model discovery.",
        cause,
      }),
  });
