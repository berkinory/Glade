import { Effect } from "effect";
import {
  isShellEnvironmentHydrated,
  listLoginShellCandidates,
  mergePathEntries,
  readPathFromLaunchctl,
  readPathFromLoginShell,
} from "@glade/shared/platform/shell";
import { createCachedLoginShellPathReader } from "@glade/shared/platform/loginShellEnvironment";
import { resolveGladeHomeDirectory } from "@glade/shared/platform/gladeHome";

function logPathHydrationWarning(message: string, error?: unknown): void {
  console.warn(`[server] ${message}`, error instanceof Error ? error.message : (error ?? ""));
}

export function fixPath(
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    readPath?: typeof readPathFromLoginShell;
    readLaunchctlPath?: typeof readPathFromLaunchctl;
    userShell?: string;
    logWarning?: (message: string, error?: unknown) => void;
  } = {},
): void {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return;

  const env = options.env ?? process.env;

  if (isShellEnvironmentHydrated(env)) return;

  const logWarning = options.logWarning ?? logPathHydrationWarning;

  try {
    // launchctl stays a last resort, never a fast path: `launchctl getenv PATH` is a launchd-session
    // value that something published once (often a login-item plist with a hardcoded string), so it can
    // be arbitrarily stale, while the login-shell probe is the PATH the user actually has in their
    // terminal.
    const readLaunchctlFallbackPath = (): string | undefined =>
      platform === "darwin" ? (options.readLaunchctlPath ?? readPathFromLaunchctl)() : undefined;

    const readPath = options.readPath ?? createCachedLoginShellPathReader({ env, platform });

    let shellPath: string | undefined;
    for (const shell of listLoginShellCandidates(platform, env.SHELL, options.userShell)) {
      try {
        shellPath = readPath(shell);
      } catch (error) {
        logWarning(`Failed to read PATH from login shell ${shell}.`, error);
      }

      if (shellPath) {
        break;
      }
    }

    const mergedPath = mergePathEntries(
      shellPath || readLaunchctlFallbackPath(),
      env.PATH,
      platform,
    );
    if (mergedPath) {
      env.PATH = mergedPath;
    }
  } catch (error) {
    logWarning("Failed to hydrate PATH from the user environment.", error);
  }
}

export const resolveBaseDir = (raw: string | undefined): Effect.Effect<string> =>
  Effect.succeed(resolveGladeHomeDirectory({ configuredHome: raw }));
