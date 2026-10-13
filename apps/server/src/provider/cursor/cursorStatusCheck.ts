import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { Effect, Option, Result } from "effect";

import { buildProviderChildEnvironment } from "../core/providerChildEnvironment.ts";
import { runProviderCliCommand } from "../core/providerCliCommand.ts";
import { nonEmptyTrimmed } from "../core/providerCliOutput.ts";
import { checkProviderCliVersion } from "../core/providerCliVersionProbe.ts";
import { parseGenericCliVersion } from "../core/providerMaintenance.ts";
import type { ProviderStatusCheck } from "../core/serverProviderDescriptor.ts";
import { CURSOR_CLI } from "./cursorCli.ts";
import { CURSOR_CREDENTIAL_GRANTS } from "./cursorEnvironment.ts";

const PROVIDER = "cursor" as const;
const TIMEOUT_MS = 20_000;

export const checkCursorProviderStatus: ProviderStatusCheck = (settings) =>
  Effect.gen(function* () {
    const executable = nonEmptyTrimmed(settings.providers.cursor.binaryPath) ?? CURSOR_CLI.command;
    const env = buildProviderChildEnvironment({ credentialGrants: CURSOR_CREDENTIAL_GRANTS });
    const checkedAt = new Date().toISOString();
    const versionCheck = yield* checkProviderCliVersion({
      provider: PROVIDER,
      cli: CURSOR_CLI,
      label: "Cursor",
      versionCommand: runProviderCliCommand(executable, ["--version"], { env }),
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
    const status = yield* runProviderCliCommand(executable, ["status"], { env }).pipe(
      Effect.timeoutOption(TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(status) || Option.isNone(status.success)) {
      return {
        ...installed,
        status: "warning",
        authStatus: "unknown",
        message: "Could not read Cursor's sign-in status.",
      } satisfies ServerProviderStatus;
    }
    const output = `${status.success.value.stdout}\n${status.success.value.stderr}`;
    if (/logged in/i.test(output) && !/not logged in/i.test(output)) {
      return {
        ...installed,
        status: "ready",
        authStatus: "authenticated",
        authLabel: "Cursor account",
      } satisfies ServerProviderStatus;
    }
    return nonEmptyTrimmed(process.env.CURSOR_API_KEY)
      ? ({
          ...installed,
          status: "ready",
          authStatus: "authenticated",
          authLabel: "API key",
        } satisfies ServerProviderStatus)
      : ({
          ...installed,
          status: "warning",
          authStatus: "unauthenticated",
          message: "Sign in to Cursor with `cursor-agent login`.",
        } satisfies ServerProviderStatus);
  });
