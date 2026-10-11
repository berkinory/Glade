import { Effect } from "effect";

import type { GitHubHttp } from "./gitHubHttp.ts";
import type { GitHubRepositoryRef } from "./gitHubRepositoryContext.ts";

const AVATAR_TTL_MS = 60 * 60_000;
const MAX_CACHED_EMAILS = 2_000;
const MAX_LOOKUPS_PER_REQUEST = 50;

const NUMBERED_NOREPLY = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/i;
const LEGACY_NOREPLY = /^([^@+]+)@users\.noreply\.github\.com$/i;

function avatarFromNoreplyEmail(email: string): string | null {
  const numbered = NUMBERED_NOREPLY.exec(email);
  if (numbered?.[1]) return `https://avatars.githubusercontent.com/u/${numbered[1]}?v=4`;
  const legacy = LEGACY_NOREPLY.exec(email);
  return legacy?.[1] ? `https://github.com/${encodeURIComponent(legacy[1])}.png` : null;
}

type CommitAuthorNode = {
  readonly author?: {
    readonly avatarUrl?: string;
    readonly user?: { readonly login: string } | null;
  };
} | null;

/**
 * Resolves avatars by author email, so one pushed commit per author covers their unpushed commits
 * too. Emails GitHub cannot link to an account stay out of the result rather than becoming identicons.
 */
export function makeCommitAuthorAvatars(http: GitHubHttp) {
  // `null` records an email GitHub knows has no account, so it is not looked up again.
  const cache = new Map<string, { readonly avatarUrl: string | null; readonly at: number }>();

  const remember = (email: string, avatarUrl: string | null) => {
    if (cache.size >= MAX_CACHED_EMAILS) cache.delete(cache.keys().next().value ?? "");
    cache.set(email, { avatarUrl, at: Date.now() });
  };

  return (
    repository: GitHubRepositoryRef,
    commits: ReadonlyArray<{ readonly sha: string; readonly email: string }>,
  ) =>
    Effect.gen(function* () {
      const avatars: Record<string, string> = {};
      const lookups = new Map<string, string>();
      for (const { sha, email: rawEmail } of commits) {
        const email = rawEmail.trim().toLowerCase();
        if (!email || email in avatars || lookups.has(email)) continue;
        const noreply = avatarFromNoreplyEmail(email);
        if (noreply) {
          avatars[email] = noreply;
          continue;
        }
        const cached = cache.get(email);
        if (cached && Date.now() - cached.at < AVATAR_TTL_MS) {
          if (cached.avatarUrl) avatars[email] = cached.avatarUrl;
          continue;
        }
        if (lookups.size < MAX_LOOKUPS_PER_REQUEST && /^[0-9a-f]{40}$/i.test(sha)) {
          lookups.set(email, sha);
        }
      }
      if (lookups.size === 0) return avatars;

      const entries = [...lookups.entries()];
      const fields = entries
        .map(
          (_, index) =>
            `c${index}: object(oid: $o${index}) { ... on Commit { author { avatarUrl user { login } } } }`,
        )
        .join("\n");
      const variables: Record<string, string> = {
        owner: repository.owner,
        name: repository.name,
      };
      const parameters = entries.map((_, index) => `$o${index}: GitObjectID!`).join(", ");
      entries.forEach(([, sha], index) => {
        variables[`o${index}`] = sha;
      });
      const data = (yield* http.graphql({
        operation: "resolveCommitAuthorAvatars",
        query: `query($owner: String!, $name: String!, ${parameters}) { repository(owner: $owner, name: $name) { ${fields} } }`,
        variables,
        priority: "background",
      })) as { repository?: Record<string, CommitAuthorNode> | null } | null;

      entries.forEach(([email], index) => {
        const node = data?.repository?.[`c${index}`];
        // A missing commit is not pushed yet; it says nothing about the author, so nothing is cached.
        if (!node) return;
        const avatarUrl = node.author?.user && node.author.avatarUrl ? node.author.avatarUrl : null;
        remember(email, avatarUrl);
        if (avatarUrl) avatars[email] = avatarUrl;
      });
      return avatars;
    });
}
