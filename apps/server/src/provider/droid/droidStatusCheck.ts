import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { Effect, Option, Result, Schema } from "effect";

import { decodeJsonResult } from "../../platform/schemaJson.ts";
import { buildProviderChildEnvironment } from "../core/providerChildEnvironment.ts";
import { runProviderCliCommand } from "../core/providerCliCommand.ts";
import { nonEmptyTrimmed } from "../core/providerCliOutput.ts";
import { checkProviderCliVersion } from "../core/providerCliVersionProbe.ts";
import { parseGenericCliVersion } from "../core/providerMaintenance.ts";
import type { ProviderStatusCheck } from "../core/serverProviderDescriptor.ts";
import { DROID_CLI } from "./droidCli.ts";
import { DROID_CREDENTIAL_GRANTS, DROID_PROCESS_OVERRIDES } from "./droidEnvironment.ts";

const PROVIDER = "factoryDroid" as const;
const TIMEOUT_MS = 20_000;

// `droid doctor` verifies the stored login without printing it; only each check's outcome is read.
const AUTH_DOCTOR_ARGS = ["doctor", "--checks", "auth", "--json"];
const decodeDoctorReport = decodeJsonResult(
  Schema.Struct({
    results: Schema.Array(Schema.Struct({ id: Schema.String, status: Schema.String })),
  }),
);

export const checkDroidProviderStatus: ProviderStatusCheck = (settings) =>
  Effect.gen(function* () {
    const executable =
      nonEmptyTrimmed(settings.providers.factoryDroid.binaryPath) ?? DROID_CLI.command;
    const env = buildProviderChildEnvironment({
      credentialGrants: DROID_CREDENTIAL_GRANTS,
      overrides: DROID_PROCESS_OVERRIDES,
    });
    const checkedAt = new Date().toISOString();
    const versionCheck = yield* checkProviderCliVersion({
      provider: PROVIDER,
      cli: DROID_CLI,
      label: DROID_CLI.displayName,
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
    if (nonEmptyTrimmed(process.env.FACTORY_API_KEY)) {
      return {
        ...installed,
        status: "ready",
        authStatus: "authenticated",
        authLabel: "API key",
      } satisfies ServerProviderStatus;
    }
    const doctor = yield* runProviderCliCommand(executable, AUTH_DOCTOR_ARGS, { env }).pipe(
      Effect.timeoutOption(TIMEOUT_MS),
      Effect.result,
    );
    const report =
      Result.isSuccess(doctor) && Option.isSome(doctor.success)
        ? decodeDoctorReport(doctor.success.value.stdout)
        : undefined;
    if (!report || Result.isFailure(report)) {
      return {
        ...installed,
        status: "warning",
        authStatus: "unknown",
        message: "Could not read Droid's sign-in status.",
      } satisfies ServerProviderStatus;
    }
    const verified = report.success.results.some(
      (check) => check.id === "auth.verify" && check.status === "pass",
    );
    return verified
      ? ({
          ...installed,
          status: "ready",
          authStatus: "authenticated",
          authLabel: "Factory account",
        } satisfies ServerProviderStatus)
      : ({
          ...installed,
          status: "warning",
          authStatus: "unauthenticated",
          message: "Sign in to Droid by running `droid`.",
        } satisfies ServerProviderStatus);
  });
