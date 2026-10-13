import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { Effect, Option, Result } from "effect";

import { isProviderVersionSupported, providerUpgradeMessage } from "./compatibility.ts";
import { detailFromResult, isCommandMissingCause, type CommandResult } from "./providerCliOutput";
import type { ProviderCli } from "./serverProviderDescriptor.ts";

type ProviderCliVersionProbeOutcome =
  | { readonly outcome: "missing"; readonly cause: unknown }
  | { readonly outcome: "failure"; readonly cause: unknown }
  | { readonly outcome: "timeout" }
  | { readonly outcome: "nonzero"; readonly result: CommandResult }
  | { readonly outcome: "success"; readonly result: CommandResult };

const probeProviderCliVersion = <ErrorType, Requirements>(
  command: Effect.Effect<CommandResult, ErrorType, Requirements>,
  timeoutMs: number,
): Effect.Effect<ProviderCliVersionProbeOutcome, never, Requirements> =>
  command.pipe(
    Effect.timeoutOption(timeoutMs),
    Effect.result,
    Effect.map((probe): ProviderCliVersionProbeOutcome => {
      if (Result.isFailure(probe)) {
        return isCommandMissingCause(probe.failure)
          ? { outcome: "missing", cause: probe.failure }
          : { outcome: "failure", cause: probe.failure };
      }
      if (Option.isNone(probe.success)) {
        return { outcome: "timeout" };
      }
      const result = probe.success.value;
      return result.code === 0 ? { outcome: "success", result } : { outcome: "nonzero", result };
    }),
  );

// Succeeds with the installed version, or fails with the status a missing, broken or unsupported
// CLI reports.
export const checkProviderCliVersion = <ErrorType, Requirements>(input: {
  readonly provider: ProviderKind;
  readonly cli: ProviderCli;
  // How health messages name the CLI, for example "Claude Agent".
  readonly label: string;
  readonly versionCommand: Effect.Effect<CommandResult, ErrorType, Requirements>;
  readonly timeoutMs: number;
  readonly parseVersion: (output: string) => string | null;
  readonly checkedAt: string;
}): Effect.Effect<Result.Result<string, ServerProviderStatus>, never, Requirements> =>
  probeProviderCliVersion(input.versionCommand, input.timeoutMs).pipe(
    Effect.map((probe) => {
      const unavailable = (message: string): ServerProviderStatus => ({
        provider: input.provider,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt: input.checkedAt,
        message,
      });
      const failedToRun = `${input.label} CLI is installed but failed to run.`;
      switch (probe.outcome) {
        case "missing":
          return Result.fail(
            unavailable(
              `${input.label} CLI (\`${input.cli.command}\`) is not installed or not on PATH.`,
            ),
          );
        case "failure":
          return Result.fail(
            unavailable(
              `Failed to execute ${input.label} CLI health check: ${probe.cause instanceof Error ? probe.cause.message : String(probe.cause)}.`,
            ),
          );
        case "timeout":
          return Result.fail(unavailable(`${failedToRun} Timed out while running command.`));
        case "nonzero": {
          const detail = detailFromResult(probe.result);
          return Result.fail(unavailable(detail ? `${failedToRun} ${detail}` : failedToRun));
        }
        case "success": {
          const version = input.parseVersion(`${probe.result.stdout}\n${probe.result.stderr}`);
          if (version !== null && isProviderVersionSupported(input.cli, version)) {
            return Result.succeed(version);
          }
          return Result.fail({
            provider: input.provider,
            status: version === null ? "error" : "update-required",
            available: false,
            authStatus: "unknown",
            checkedAt: input.checkedAt,
            version,
            message: providerUpgradeMessage(input.cli, version),
          });
        }
      }
    }),
  );
