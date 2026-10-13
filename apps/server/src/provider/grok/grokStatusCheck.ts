import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { Effect, Result } from "effect";

import { buildProviderChildEnvironment } from "../core/providerChildEnvironment.ts";
import { runProviderCliCommand } from "../core/providerCliCommand.ts";
import { nonEmptyTrimmed } from "../core/providerCliOutput.ts";
import { checkProviderCliVersion } from "../core/providerCliVersionProbe.ts";
import { parseGenericCliVersion } from "../core/providerMaintenance.ts";
import type { ProviderStatusCheck } from "../core/serverProviderDescriptor.ts";
import { GROK_CLI } from "./grokCli.ts";
import { GROK_CREDENTIAL_GRANTS, grokHome } from "./grokEnvironment.ts";

const PROVIDER = "grok" as const;
const TIMEOUT_MS = 20_000;

// Sign-in stores one entry per account in auth.json; only the presence of an entry is read.
const hasStoredLogin = (home: string) =>
  Effect.promise(async () => {
    try {
      const parsed: unknown = JSON.parse(await readFile(path.join(home, "auth.json"), "utf8"));
      return typeof parsed === "object" && parsed !== null && Object.keys(parsed).length > 0;
    } catch {
      return false;
    }
  });

export const makeGrokStatusCheck =
  (context: { readonly homeDir: string }): ProviderStatusCheck =>
  (settings) =>
    Effect.gen(function* () {
      const executable = nonEmptyTrimmed(settings.providers.grok.binaryPath) ?? GROK_CLI.command;
      const env = buildProviderChildEnvironment({ credentialGrants: GROK_CREDENTIAL_GRANTS });
      const checkedAt = new Date().toISOString();
      const versionCheck = yield* checkProviderCliVersion({
        provider: PROVIDER,
        cli: GROK_CLI,
        label: "Grok Build",
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
      if (yield* hasStoredLogin(grokHome(process.env, context.homeDir))) {
        return {
          ...installed,
          status: "ready",
          authStatus: "authenticated",
          authLabel: "Grok account",
        } satisfies ServerProviderStatus;
      }
      if (nonEmptyTrimmed(process.env.XAI_API_KEY)) {
        return {
          ...installed,
          status: "ready",
          authStatus: "authenticated",
          authLabel: "API key",
        } satisfies ServerProviderStatus;
      }
      return {
        ...installed,
        status: "warning",
        authStatus: "unauthenticated",
        message: "Sign in to Grok Build with `grok login`.",
      } satisfies ServerProviderStatus;
    });
