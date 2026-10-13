import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { Effect, FileSystem, Option, Path, Result } from "effect";
import { runProviderCliCommand } from "../core/providerCliCommand.ts";
import { nonEmptyTrimmed } from "../core/providerCliOutput.ts";
import { checkProviderCliVersion } from "../core/providerCliVersionProbe.ts";
import type { ProviderStatusCheck } from "../core/serverProviderDescriptor.ts";
import { codexAuthMetadata, parseCodexAuthStatusFromOutput } from "./codexAuthStatus.ts";
import { CODEX_CLI, parseCodexCliVersion } from "./codexCliVersion.ts";
import { parseCodexConfigModelProvider } from "./codexConfig.ts";
import { resolveBaseCodexHomePath } from "./codexHomePaths.ts";
import { buildCodexProcessEnv } from "./codexProcessEnv.ts";

const PROVIDER = "codex" as const;
const TIMEOUT_MS = 4_000;
const AUTH_STATUS_ARGS = ["-c", "mcp_servers={}", "login", "status"] as const;

// For any other model provider the auth probe is skipped because authentication is handled
// externally (e.g. via environment variables like `PORTKEY_API_KEY` or `AZURE_API_KEY`).
const OPENAI_AUTH_PROVIDERS = new Set(["openai"]);

const hasCustomModelProvider = (env: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const content = yield* fileSystem
      .readFileString(path.join(resolveBaseCodexHomePath(env), "config.toml"))
      .pipe(Effect.orElseSucceed(() => undefined));
    const provider = content === undefined ? undefined : parseCodexConfigModelProvider(content);
    return provider !== undefined && !OPENAI_AUTH_PROVIDERS.has(provider);
  });

export const checkCodexProviderStatus: ProviderStatusCheck = (settings) => {
  const { binaryPath, homePath } = settings.providers.codex;
  const executable = nonEmptyTrimmed(binaryPath) ?? CODEX_CLI.command;
  return Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const normalizedHomePath = nonEmptyTrimmed(homePath);
    const probeEnv = yield* Effect.promise(() =>
      buildCodexProcessEnv(normalizedHomePath ? { homePath: normalizedHomePath } : {}),
    );
    // Probes run from the provider home so account state never merges project config from the
    // server's working directory. A missing home is reported, never created.
    const codexHome = resolveBaseCodexHomePath(probeEnv);
    const fileSystem = yield* FileSystem.FileSystem;
    const codexHomeExists = yield* fileSystem.stat(codexHome).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );

    const versionCheck = yield* checkProviderCliVersion({
      provider: PROVIDER,
      cli: CODEX_CLI,
      label: "Codex",
      versionCommand: runProviderCliCommand(executable, ["--version"], {
        env: probeEnv,
        cwd: codexHomeExists ? codexHome : undefined,
      }),
      timeoutMs: TIMEOUT_MS,
      parseVersion: parseCodexCliVersion,
      checkedAt,
    });
    if (Result.isFailure(versionCheck)) return versionCheck.failure;
    const installed = {
      provider: PROVIDER,
      available: true,
      version: versionCheck.success,
      supportsAutoRuntimeMode: true,
      checkedAt,
    } as const;
    const unverified = (message: string): ServerProviderStatus => ({
      ...installed,
      status: "warning",
      authStatus: "unknown",
      message,
    });

    if (yield* hasCustomModelProvider(probeEnv)) {
      return {
        ...installed,
        status: "ready",
        authStatus: "unknown",
        message: "Using a custom Codex model provider; OpenAI login check skipped.",
      };
    }

    if (!codexHomeExists) {
      return unverified(
        `Could not verify Codex authentication status: the Codex home ${codexHome} does not exist. Sign in with the Codex CLI to create it.`,
      );
    }

    const authProbe = yield* runProviderCliCommand(executable, AUTH_STATUS_ARGS, {
      env: probeEnv,
      cwd: codexHome,
    }).pipe(Effect.timeoutOption(TIMEOUT_MS), Effect.result);

    if (Result.isFailure(authProbe)) {
      const error = authProbe.failure;
      return unverified(
        error instanceof Error
          ? `Could not verify Codex authentication status: ${error.message}.`
          : "Could not verify Codex authentication status.",
      );
    }

    if (Option.isNone(authProbe.success)) {
      return unverified(
        "Could not verify Codex authentication status. Timed out while running command.",
      );
    }

    const authOutput = authProbe.success.value;
    const parsed = parseCodexAuthStatusFromOutput(authOutput);
    const auth = parsed.authStatus === "authenticated" ? codexAuthMetadata(authOutput) : undefined;

    return {
      ...installed,
      status: parsed.status,
      authStatus: parsed.authStatus,
      ...(auth?.type ? { authType: auth.type } : {}),
      ...(auth?.label ? { authLabel: auth.label } : {}),
      ...(parsed.voiceTranscriptionAvailable !== undefined
        ? { voiceTranscriptionAvailable: parsed.voiceTranscriptionAvailable }
        : {}),
      ...(parsed.message ? { message: parsed.message } : {}),
    } satisfies ServerProviderStatus;
  });
};
