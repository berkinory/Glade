import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { Cache, Duration, Effect, Option, Result } from "effect";
import { runProviderCliCommand } from "../core/providerCliCommand.ts";
import { extractSubscriptionTypeFromOutput, nonEmptyTrimmed } from "../core/providerCliOutput.ts";
import { checkProviderCliVersion } from "../core/providerCliVersionProbe.ts";
import { parseGenericCliVersion } from "../core/providerMaintenance.ts";
import type { ProviderStatusCheck } from "../core/serverProviderDescriptor.ts";
import { loadClaudeAgentSdk } from "./claudeAgentSdk.ts";
import {
  claudeAuthMetadata,
  extractClaudeAuthMethodFromOutput,
  isStructuredClaudeAuthFalseNegativeCandidate,
  parseClaudeAuthStatusFromOutput,
} from "./claudeAuthStatus.ts";
import { acquireClaudeAuthStatusLock } from "./claudeAuthStatusLock.ts";
import { CLAUDE_CLI } from "./claudeCli.ts";
import { buildClaudeProcessEnv, readClaudeCliCredentialsSummary } from "./claudeProcessEnv.ts";

const PROVIDER = "claudeAgent" as const;
const TIMEOUT_MS = 20_000;
const SUBSCRIPTION_PROBE_TIMEOUT_MS = 8_000;
const AUTH_FALSE_NEGATIVE_RETRY_DELAY_MS = 1_000;

function waitForAbortSignal(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

// The prompt is a never-yielding AsyncIterable so no user message reaches the Anthropic API — we
// get account metadata (including subscription type) from local IPC, then abort the subprocess.
const probeClaudeSubscription = (binaryPath: string, env: NodeJS.ProcessEnv) => {
  const abort = new AbortController();
  return Effect.tryPromise(async () => {
    const { query: claudeQuery } = await loadClaudeAgentSdk();
    const q = claudeQuery({
      // oxlint-disable-next-line require-yield
      prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
        await waitForAbortSignal(abort.signal);
      })(),
      options: {
        persistSession: false,
        pathToClaudeCodeExecutable: binaryPath,
        env,
        abortController: abort,
        settingSources: ["user", "project", "local"],
        allowedTools: [],
        stderr: () => {},
      },
    });
    const init = await q.initializationResult();
    return init.account?.subscriptionType;
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (!abort.signal.aborted) abort.abort();
      }),
    ),
    Effect.timeoutOption(SUBSCRIPTION_PROBE_TIMEOUT_MS),
    Effect.result,
    Effect.map((result) =>
      Result.isFailure(result) ? undefined : Option.getOrUndefined(result.success),
    ),
  );
};

const checkClaudeProviderStatus = (input: {
  readonly binaryPath: string;
  readonly homeDir: string;
  readonly resolveSubscriptionType: Effect.Effect<string | undefined>;
}) =>
  Effect.gen(function* () {
    const executable = nonEmptyTrimmed(input.binaryPath) ?? CLAUDE_CLI.command;
    const { homeDir, resolveSubscriptionType } = input;
    const checkedAt = new Date().toISOString();
    const claudeEnv = buildClaudeProcessEnv(
      homeDir ? { env: process.env, homeDir } : { env: process.env },
    );

    const versionCheck = yield* checkProviderCliVersion({
      provider: PROVIDER,
      cli: CLAUDE_CLI,
      label: "Claude Agent",
      versionCommand: runProviderCliCommand(executable, ["--version"], { env: claudeEnv }),
      timeoutMs: TIMEOUT_MS,
      parseVersion: parseGenericCliVersion,
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

    const runAuthStatusProbe = Effect.acquireUseRelease(
      Effect.promise(() => acquireClaudeAuthStatusLock()),
      () =>
        runProviderCliCommand(executable, ["auth", "status"], { env: claudeEnv }).pipe(
          Effect.timeoutOption(TIMEOUT_MS),
        ),
      (release) => Effect.sync(release),
    ).pipe(Effect.result);

    const authProbe = yield* runAuthStatusProbe;

    const unverified = (message: string): ServerProviderStatus => ({
      ...installed,
      status: "warning",
      authStatus: "unknown",
      message,
    });

    if (Result.isFailure(authProbe)) {
      const error = authProbe.failure;
      return unverified(
        error instanceof Error
          ? `Could not verify Claude authentication status: ${error.message}.`
          : "Could not verify Claude authentication status.",
      );
    }

    if (Option.isNone(authProbe.success)) {
      return unverified(
        "Could not verify Claude authentication status. Timed out while running command.",
      );
    }

    let authOutput = authProbe.success.value;
    let parsed = parseClaudeAuthStatusFromOutput(authOutput);
    const credentialSummary = readClaudeCliCredentialsSummary(
      homeDir ? { env: claudeEnv, homeDir } : { env: claudeEnv },
    );
    // A structured `loggedIn:false` with a clean exit and no local credential record to rescue it
    // (macOS keeps OAuth in the Keychain, not on disk) is the signature of a lost refresh-token
    // rotation race with a concurrent `claude auth status` invocation.
    if (
      !credentialSummary.usable &&
      isStructuredClaudeAuthFalseNegativeCandidate(authOutput, parsed)
    ) {
      yield* Effect.sleep(AUTH_FALSE_NEGATIVE_RETRY_DELAY_MS);
      const retryProbe = yield* runAuthStatusProbe;
      if (Result.isSuccess(retryProbe) && Option.isSome(retryProbe.success)) {
        authOutput = retryProbe.success.value;
        parsed = parseClaudeAuthStatusFromOutput(authOutput);
      }
    }
    const structuredFalseNegative = isStructuredClaudeAuthFalseNegativeCandidate(
      authOutput,
      parsed,
    );
    const credentialProbeSubscriptionType =
      credentialSummary.usable && structuredFalseNegative
        ? yield* resolveSubscriptionType
        : undefined;

    const effectiveParsed: ReturnType<typeof parseClaudeAuthStatusFromOutput> =
      credentialProbeSubscriptionType !== undefined
        ? { status: "ready", authStatus: "authenticated" }
        : parsed;
    const useCredentialMetadata = credentialProbeSubscriptionType !== undefined;

    let subscriptionType =
      extractSubscriptionTypeFromOutput(authOutput) ??
      credentialProbeSubscriptionType ??
      (useCredentialMetadata ? credentialSummary.subscriptionType : undefined);
    const authMethod =
      extractClaudeAuthMethodFromOutput(authOutput) ??
      (useCredentialMetadata ? "claude.ai" : undefined);
    if (!subscriptionType && effectiveParsed.authStatus === "authenticated") {
      subscriptionType = yield* resolveSubscriptionType;
    }
    const authMetadata = claudeAuthMetadata({ subscriptionType, authMethod });

    return {
      ...installed,
      status: effectiveParsed.status,
      authStatus: effectiveParsed.authStatus,
      ...(authMetadata ? { authType: authMetadata.type, authLabel: authMetadata.label } : {}),
      ...(effectiveParsed.message ? { message: effectiveParsed.message } : {}),
    } satisfies ServerProviderStatus;
  });

export const makeClaudeStatusCheck = (context: { readonly homeDir: string }) =>
  Effect.gen(function* () {
    const subscriptionCache = yield* Cache.make({
      capacity: 8,
      timeToLive: Duration.minutes(5),
      lookup: (binaryPath: string) =>
        probeClaudeSubscription(
          binaryPath,
          buildClaudeProcessEnv({ env: process.env, homeDir: context.homeDir }),
        ),
    });
    const check: ProviderStatusCheck = (settings) => {
      const binaryPath = settings.providers.claudeAgent.binaryPath;
      return Cache.invalidate(subscriptionCache, CLAUDE_CLI.command).pipe(
        Effect.andThen(
          checkClaudeProviderStatus({
            binaryPath,
            homeDir: context.homeDir,
            resolveSubscriptionType: Cache.get(
              subscriptionCache,
              nonEmptyTrimmed(binaryPath) ?? CLAUDE_CLI.command,
            ),
          }),
        ),
      );
    };
    return check;
  });
