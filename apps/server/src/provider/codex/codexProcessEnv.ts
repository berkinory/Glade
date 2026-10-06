import { readActiveCodexProviderEnvKey } from "./codexConfig";
import {
  readEnvironmentFromLoginShell,
  resolveLoginShell,
  type ShellEnvironmentReader,
} from "@glade/shared/platform/shell";
import {
  buildProviderChildEnvironment,
  registerProviderCredentialKey,
} from "../core/providerChildEnvironment.ts";

// Kept in memory only: the value is a provider API key and must never reach a disk cache.
// Missing keys are memoized too, so a shell without the export is probed once per process.
const loginShellProviderKeys = new Map<string, string | undefined>();

function readProviderKeyFromLoginShell(
  shell: string,
  envKey: string,
  readEnvironment: ShellEnvironmentReader,
): string | undefined {
  const memoKey = `${shell}\0${envKey}`;
  if (loginShellProviderKeys.has(memoKey)) return loginShellProviderKeys.get(memoKey);
  let value: string | undefined;
  try {
    value = readEnvironment(shell, [envKey])[envKey];
  } catch {
    value = undefined;
  }
  loginShellProviderKeys.set(memoKey, value);
  return value;
}

export async function buildCodexProcessEnv(
  input: {
    readonly env?: NodeJS.ProcessEnv;
    readonly homePath?: string;
    readonly platform?: NodeJS.Platform;
    readonly readEnvironment?: ShellEnvironmentReader;
  } = {},
): Promise<NodeJS.ProcessEnv> {
  const baseEnv = { ...(input.env ?? process.env) };
  const configuredEnv = input.homePath ? { ...baseEnv, CODEX_HOME: input.homePath } : baseEnv;
  const platform = input.platform ?? process.platform;
  const effectiveEnv = buildProviderChildEnvironment({
    provider: "codex",
    baseEnv: configuredEnv,
  });
  const providerEnvKey = readActiveCodexProviderEnvKey(effectiveEnv);
  if (providerEnvKey) registerProviderCredentialKey(providerEnvKey);

  if (
    providerEnvKey &&
    !effectiveEnv[providerEnvKey]?.trim() &&
    (platform === "darwin" || platform === "linux")
  ) {
    const shell = resolveLoginShell(platform, effectiveEnv.SHELL);
    const value = shell
      ? readProviderKeyFromLoginShell(
          shell,
          providerEnvKey,
          input.readEnvironment ?? readEnvironmentFromLoginShell,
        )
      : undefined;
    if (value) effectiveEnv[providerEnvKey] = value;
  }

  return effectiveEnv;
}
