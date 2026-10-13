import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { spawnProcess } from "@glade/shared/platform/processRuntime";
import { Effect, Option, Result } from "effect";

import { ProviderAdapterRequestError } from "../core/Errors.ts";
import { runProviderCliCommand } from "../core/providerCliCommand.ts";
import { nonEmptyTrimmed } from "../core/providerCliOutput.ts";
import { checkProviderCliVersion } from "../core/providerCliVersionProbe.ts";
import { parseGenericCliVersion } from "../core/providerMaintenance.ts";
import type { ProviderStatusCheck } from "../core/serverProviderDescriptor.ts";
import { callMsp } from "./mspConnection.ts";
import { MspAccountState } from "./mspProtocol.ts";
import { MUSE_CLI } from "./museCli.ts";
import { museChildEnvironment } from "./museEnvironment.ts";
import { withEphemeralMuseHost } from "./museHost.ts";

const PROVIDER = "museCode" as const;
const TIMEOUT_MS = 20_000;

const ACCOUNT_LABELS: Readonly<Record<string, string>> = {
  accountLogin: "Meta account",
  apiKey: "Stored API key",
  envKey: "META_API_KEY",
};

// Muse may keep its login in the system keychain, so the host's own account projection is the only
// reliable sign-in signal.
const readAccount = (executable: string) =>
  Effect.tryPromise({
    try: (signal) =>
      withEphemeralMuseHost({
        spawn: ({ cwd, args }) =>
          spawnProcess(executable, args, {
            requireExecutable: true,
            cwd,
            env: museChildEnvironment(),
            stdio: ["pipe", "pipe", "pipe"],
          }),
        cwd: process.cwd(),
        binaryPath: executable,
        signal,
        use: (connection) => callMsp(connection, "account/read", {}, MspAccountState),
      }),
    catch: (cause) =>
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "account/read",
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

export const checkMuseProviderStatus: ProviderStatusCheck = (settings) =>
  Effect.gen(function* () {
    const executable = nonEmptyTrimmed(settings.providers.museCode.binaryPath) ?? MUSE_CLI.command;
    const checkedAt = new Date().toISOString();
    const versionCheck = yield* checkProviderCliVersion({
      provider: PROVIDER,
      cli: MUSE_CLI,
      label: "Muse Code",
      versionCommand: runProviderCliCommand(executable, ["--version"], {
        env: museChildEnvironment(),
      }),
      timeoutMs: TIMEOUT_MS,
      parseVersion: parseGenericCliVersion,
      checkedAt,
    });
    if (Result.isFailure(versionCheck)) return versionCheck.failure;
    const installed = {
      provider: PROVIDER,
      available: true,
      version: versionCheck.success,
      checkedAt,
    } as const;
    const account = yield* readAccount(executable).pipe(
      Effect.timeoutOption(TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(account) || Option.isNone(account.success)) {
      return {
        ...installed,
        status: "warning",
        authStatus: "unknown",
        message: "Could not read Muse Code's sign-in state.",
      } satisfies ServerProviderStatus;
    }
    const state = account.success.value;
    if (state.state !== "loggedOut" || !state.credentialRequired) {
      const authLabel = state.label?.trim() || ACCOUNT_LABELS[state.state];
      return {
        ...installed,
        status: "ready",
        authStatus: "authenticated",
        ...(authLabel ? { authLabel } : {}),
      } satisfies ServerProviderStatus;
    }
    return {
      ...installed,
      status: "warning",
      authStatus: "unauthenticated",
      message: "Sign in to Muse Code with `muse login`.",
    } satisfies ServerProviderStatus;
  });
