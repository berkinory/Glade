import { createHash } from "node:crypto";
import { Effect, Semaphore } from "effect";

import { runProcess } from "../../platform/processRunner";
import { GitHubError } from "../Errors.ts";

export const GITHUB_HOST = "github.com";

export interface GitHubCredentials {
  readonly resolve: Effect.Effect<GitHubCredential, GitHubError>;
  readonly invalidate: Effect.Effect<void>;
}

interface GitHubCredential {
  readonly token: string;
  /** `host:sha256(token)`; safe for cache keys, rate-limit scopes and logs. */
  readonly fingerprint: string;
}

const TOKEN_TTL_MS = 5 * 60_000;
const SIGNED_OUT_TTL_MS = 10_000;

function fingerprintOf(token: string): string {
  return `${GITHUB_HOST}:${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;
}

function notAuthenticated(detail: string): GitHubError {
  return new GitHubError({ operation: "credentials", reason: "not-authenticated", detail });
}

/**
 * The `gh` CLI is only asked for its token; every read and write then goes over HTTPS. Environment
 * tokens win so CI-style setups never spawn a process.
 */
export const makeGitHubCredentials: Effect.Effect<GitHubCredentials> = Effect.gen(function* () {
  const lock = yield* Semaphore.make(1);
  let cached: { credential: GitHubCredential | null; expiresAt: number } | null = null;

  const readFromGh = Effect.tryPromise({
    try: (signal) =>
      runProcess("gh", ["auth", "token", "--hostname", GITHUB_HOST], {
        timeoutMs: 10_000,
        signal,
        allowNonZeroExit: true,
        env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_DEBUG: "", NO_COLOR: "1" },
      }),
    catch: (error) =>
      error instanceof Error && error.message.includes("Command not found: gh")
        ? new GitHubError({
            operation: "credentials",
            reason: "not-installed",
            detail: "GitHub CLI (`gh`) is required to sign in to GitHub but is not on PATH.",
          })
        : new GitHubError({
            operation: "credentials",
            reason: "other",
            detail: `Could not read the GitHub CLI token: ${error instanceof Error ? error.message : String(error)}`,
          }),
  });

  const resolve: Effect.Effect<GitHubCredential, GitHubError> = Effect.suspend(() => {
    const envToken = (process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "").trim();
    if (envToken) return Effect.succeed({ token: envToken, fingerprint: fingerprintOf(envToken) });
    if (cached && cached.expiresAt > Date.now()) {
      return cached.credential
        ? Effect.succeed(cached.credential)
        : Effect.fail(notAuthenticated("GitHub CLI is not signed in. Run `gh auth login`."));
    }
    return lock.withPermits(1)(
      Effect.gen(function* () {
        if (cached && cached.expiresAt > Date.now()) {
          if (cached.credential) return cached.credential;
          return yield* notAuthenticated("GitHub CLI is not signed in. Run `gh auth login`.");
        }
        // Failures other than "signed out" are not cached so the next read retries.
        const result = yield* readFromGh;
        const token = result.code === 0 ? result.stdout.trim() : "";
        if (!token) {
          cached = { credential: null, expiresAt: Date.now() + SIGNED_OUT_TTL_MS };
          return yield* notAuthenticated("GitHub CLI is not signed in. Run `gh auth login`.");
        }
        const credential = { token, fingerprint: fingerprintOf(token) };
        cached = { credential, expiresAt: Date.now() + TOKEN_TTL_MS };
        return credential;
      }),
    );
  });

  const invalidate = Effect.sync(() => {
    cached = null;
  });

  return { resolve, invalidate };
});
