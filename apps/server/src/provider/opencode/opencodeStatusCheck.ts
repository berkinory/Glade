import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { Effect, Option, Result } from "effect";

import { buildProviderChildEnvironment } from "../core/providerChildEnvironment.ts";
import { runProviderCliCommand } from "../core/providerCliCommand.ts";
import { nonEmptyTrimmed } from "../core/providerCliOutput.ts";
import { checkProviderCliVersion } from "../core/providerCliVersionProbe.ts";
import { parseGenericCliVersion } from "../core/providerMaintenance.ts";
import type { ProviderStatusCheck } from "../core/serverProviderDescriptor.ts";
import { OPENCODE_CLI } from "./opencodeCli.ts";

const PROVIDER = "opencode" as const;
const TIMEOUT_MS = 20_000;

export const checkOpenCodeProviderStatus: ProviderStatusCheck = (settings) =>
  Effect.gen(function* () {
    const executable =
      nonEmptyTrimmed(settings.providers.opencode.binaryPath) ?? OPENCODE_CLI.command;
    const env = buildProviderChildEnvironment({ credentialGrants: "all" });
    const checkedAt = new Date().toISOString();
    const versionCheck = yield* checkProviderCliVersion({
      provider: PROVIDER,
      cli: OPENCODE_CLI,
      label: "OpenCode",
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
    const integrations = yield* runProviderCliCommand(executable, ["auth", "list"], { env }).pipe(
      Effect.timeoutOption(TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(integrations) || Option.isNone(integrations.success)) {
      return {
        ...installed,
        status: "warning",
        authStatus: "unknown",
        message: "Could not read OpenCode's signed-in integrations.",
      } satisfies ServerProviderStatus;
    }
    const output = integrations.success.value.stdout;
    // OpenCode's free models run without any signed-in integration.
    return /no authenticated integrations/i.test(output)
      ? ({
          ...installed,
          status: "ready",
          authStatus: "unknown",
          authLabel: "Free models",
        } satisfies ServerProviderStatus)
      : ({
          ...installed,
          status: "ready",
          authStatus: "authenticated",
        } satisfies ServerProviderStatus);
  });
