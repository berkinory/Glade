import { createHash } from "node:crypto";
import { GitHubCliError } from "./Errors";

export function gitHubBudgetIdentity(env: NodeJS.ProcessEnv): string {
  // Credentials never enter cache keys or diagnostics in plaintext.
  return createHash("sha256")
    .update(
      JSON.stringify([
        "github.com",
        env.GH_TOKEN ?? env.GITHUB_TOKEN ?? null,
        env.GH_CONFIG_DIR ?? env.XDG_CONFIG_HOME ?? env.HOME ?? env.USERPROFILE ?? null,
      ]),
    )
    .digest("hex");
}

export function isGitHubRateLimit(message: string): boolean {
  return /(?:api |secondary )?rate limit (?:exceeded|reached)|secondary rate limit|abuse detection|http 429|429 too many requests/i.test(
    message,
  );
}

export class GitHubReadBudget {
  private readonly limits = new Map<string, { retryAt: number; attempts: number }>();

  check(identity: string): GitHubCliError | null {
    const limit = this.limits.get(identity);
    if (!limit || limit.retryAt <= Date.now()) return null;
    return new GitHubCliError({
      operation: "execute",
      reason: "rate-limited",
      retryAt: limit.retryAt,
      detail: `GitHub reads are paused until ${new Date(limit.retryAt).toISOString()} after a rate limit. Retry after that time.`,
    });
  }

  record(identity: string, message: string): void {
    if (!isGitHubRateLimit(message)) return;
    const now = Date.now();
    const previous = this.limits.get(identity);
    const attempts = Math.min((previous?.attempts ?? 0) + 1, 5);
    const reset = /x-ratelimit-reset\s*:\s*(\d+)/i.exec(message)?.[1];
    const retry = /retry-after\s*:\s*([^\r\n]+)/i.exec(message)?.[1]?.trim();
    const retryTime = retry
      ? /^\d+$/.test(retry)
        ? now + Number(retry) * 1000
        : Date.parse(retry)
      : NaN;
    const supplied = reset ? Number(reset) * 1000 : retryTime;
    const retryAt =
      Number.isFinite(supplied) && supplied > now
        ? supplied
        : now + Math.min(60_000 * 2 ** (attempts - 1), 15 * 60_000);
    for (const [key, value] of this.limits) {
      if (key !== identity && value.retryAt + 15 * 60_000 < now) this.limits.delete(key);
    }
    this.limits.set(identity, { retryAt: Math.max(previous?.retryAt ?? 0, retryAt), attempts });
  }
}
