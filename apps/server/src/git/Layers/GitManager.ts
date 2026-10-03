import { makeKeyedSingleFlightCache } from "../../pullRequests/KeyedSingleFlightCache";
import type { CommitMessageGenerationResult } from "../Services/TextGeneration";
import { readGitOperation } from "../gitOperationState";
import { toResolvedPullRequest } from "../gitPullRequestSummary";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";

import { Effect, FileSystem, Layer, Option, Path } from "effect";
import type {
  GitActionProgressEvent,
  GitActionProgressPhase,
  GitStackedAction,
} from "@glade/contracts/git/git";
import type { ModelSelection, ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";
import {
  resolveAutoFeatureBranchName,
  sanitizeBranchFragment,
  sanitizeFeatureBranchName,
} from "@glade/shared/git/git";
import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@glade/shared/git/githubRepository";

import { GitCommandError, TextGenerationError, gitManagerError } from "../Errors.ts";
import {
  GitManager,
  type GitActionProgressReporter,
  type GitManagerShape,
  type GitRunStackedActionOptions,
} from "../Services/GitManager.ts";
import { GitCore } from "../Services/GitCore.ts";
import { GitHandoff } from "../Services/GitHandoff.ts";
import { GitHandoffLive } from "./GitHandoff.ts";
import { GitHubCli, type GitHubPullRequestSummary } from "../Services/GitHubCli.ts";
import { TextGeneration } from "../Services/TextGeneration.ts";
import { detectPrTemplate } from "../PrTemplateDetection.ts";
import { buildGitTextGenerationCallInput } from "../textGenerationSelection.ts";

const COMMIT_TIMEOUT_MS = 10 * 60_000;
const MAX_PROGRESS_TEXT_LENGTH = 500;
const OPEN_PR_LOOKUP_LIMIT = 10;

const PR_LOOKUP_ALL_STATES_LIMIT = 20;
type StripProgressContext<T> = T extends any ? Omit<T, "actionId" | "cwd" | "action"> : never;
type GitActionProgressPayload = StripProgressContext<GitActionProgressEvent>;

interface PullRequestInfo extends Omit<GitHubPullRequestSummary, "state" | "updatedAt"> {
  readonly state: NonNullable<GitHubPullRequestSummary["state"]>;
  readonly updatedAt: string | null;
}

interface ResolvedPullRequest {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  mergeability: "mergeable" | "conflicting" | "unknown";
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
}

interface PullRequestHeadRemoteInfo {
  isCrossRepository?: boolean;
  headRepositoryNameWithOwner?: string | null;
  headRepositoryOwnerLogin?: string | null;
}

interface BranchHeadContext {
  localBranch: string;
  headBranch: string;
  headSelectors: ReadonlyArray<string>;
  preferredHeadSelector: string;
  remoteName: string | null;
  headRepositoryNameWithOwner: string | null;
  headRepositoryOwnerLogin: string | null;
  isCrossRepository: boolean;
}

interface GitTextGenerationParams {
  textGenerationModel?: string | undefined;
  textGenerationModelSelection?: ModelSelection | undefined;
  codexHomePath?: string | undefined;
  providerOptions?: ProviderStartOptions | undefined;
}

function parsePullRequestRepositoryFromUrl(
  url: string,
): { host: string; owner: string; repo: string } | null {
  const match = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/\d+(?:\/.*)?$/i.exec(url.trim());
  const host = match?.[1]?.trim() ?? "";
  const owner = match?.[2]?.trim() ?? "";
  const repo = match?.[3]?.trim() ?? "";
  return host.length > 0 && owner.length > 0 && repo.length > 0 ? { host, owner, repo } : null;
}

function parseRepositoryNameFromPullRequestUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) {
    return null;
  }
  const repository = parsePullRequestRepositoryFromUrl(trimmed);
  return repository && repository.host.toLowerCase() === "github.com" ? repository.repo : null;
}

function resolveHeadRepositoryNameWithOwner(
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
): string | null {
  const explicitRepository = pullRequest.headRepositoryNameWithOwner?.trim() ?? "";
  if (explicitRepository.length > 0) {
    return explicitRepository;
  }

  if (!pullRequest.isCrossRepository) {
    return null;
  }

  const ownerLogin = pullRequest.headRepositoryOwnerLogin?.trim() ?? "";
  const repositoryName = parseRepositoryNameFromPullRequestUrl(pullRequest.url);
  if (ownerLogin.length === 0 || !repositoryName) {
    return null;
  }

  return `${ownerLogin}/${repositoryName}`;
}

function resolvePullRequestWorktreeLocalBranchName(
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
): string {
  if (!pullRequest.isCrossRepository) {
    return pullRequest.headBranch;
  }

  const sanitizedHeadBranch = sanitizeBranchFragment(pullRequest.headBranch).trim();
  const suffix = sanitizedHeadBranch.length > 0 ? sanitizedHeadBranch : "head";
  return `glade/pr-${pullRequest.number}/${suffix}`;
}

function parseRepositoryOwnerLogin(nameWithOwner: string | null): string | null {
  const trimmed = nameWithOwner?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  const [ownerLogin] = trimmed.split("/");
  const normalizedOwnerLogin = ownerLogin?.trim() ?? "";
  return normalizedOwnerLogin.length > 0 ? normalizedOwnerLogin : null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalRepositoryNameWithOwner(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeOptionalOwnerLogin(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function resolvePullRequestHeadRepositoryNameWithOwner(
  pr: PullRequestHeadRemoteInfo & { url: string },
): string | null {
  const explicitRepository = normalizeOptionalString(pr.headRepositoryNameWithOwner);
  if (explicitRepository) {
    return explicitRepository;
  }

  if (!pr.isCrossRepository) {
    return null;
  }

  const ownerLogin = normalizeOptionalString(pr.headRepositoryOwnerLogin);
  const repositoryName = parseRepositoryNameFromPullRequestUrl(pr.url);
  if (!ownerLogin || !repositoryName) {
    return null;
  }

  return `${ownerLogin}/${repositoryName}`;
}

function matchesBranchHeadContext(
  pr: PullRequestInfo,
  headContext: Pick<
    BranchHeadContext,
    "headBranch" | "headRepositoryNameWithOwner" | "headRepositoryOwnerLogin" | "isCrossRepository"
  >,
): boolean {
  if (pr.headRefName !== headContext.headBranch) {
    return false;
  }

  const expectedHeadRepository = normalizeOptionalRepositoryNameWithOwner(
    headContext.headRepositoryNameWithOwner,
  );
  const expectedHeadOwner =
    normalizeOptionalOwnerLogin(headContext.headRepositoryOwnerLogin) ??
    parseRepositoryOwnerLogin(expectedHeadRepository);
  const prHeadRepository = normalizeOptionalRepositoryNameWithOwner(
    resolvePullRequestHeadRepositoryNameWithOwner(pr),
  );
  const prHeadOwner =
    normalizeOptionalOwnerLogin(pr.headRepositoryOwnerLogin) ??
    parseRepositoryOwnerLogin(prHeadRepository);

  if (headContext.isCrossRepository) {
    if (pr.isCrossRepository === false) {
      return false;
    }
    if ((expectedHeadRepository || expectedHeadOwner) && !prHeadRepository && !prHeadOwner) {
      return false;
    }
    if (expectedHeadRepository && prHeadRepository && expectedHeadRepository !== prHeadRepository) {
      return false;
    }
    if (expectedHeadOwner && prHeadOwner && expectedHeadOwner !== prHeadOwner) {
      return false;
    }
    return true;
  }

  if (pr.isCrossRepository === true) {
    return false;
  }
  if (expectedHeadRepository && prHeadRepository && expectedHeadRepository !== prHeadRepository) {
    return false;
  }
  if (expectedHeadOwner && prHeadOwner && expectedHeadOwner !== prHeadOwner) {
    return false;
  }
  return true;
}

function toPullRequestInfo(pullRequest: GitHubPullRequestSummary): PullRequestInfo {
  return {
    ...pullRequest,
    state: pullRequest.state ?? "open",
    updatedAt: pullRequest.updatedAt ?? null,
  };
}

function isPullRequestAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("pull request") &&
    message.includes("branch") &&
    message.includes("already exists")
  );
}

function extractPullRequestUrlFromError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const match = /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i.exec(error.message);
  return match?.[0] ?? null;
}

function sanitizeCommitMessage(generated: {
  subject: string;
  body: string;
  branch?: string | undefined;
}): {
  subject: string;
  body: string;
  branch?: string | undefined;
} {
  const rawSubject = generated.subject.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const subject = rawSubject.replace(/[.]+$/g, "").trim();
  const safeSubject = subject.length > 0 ? subject.slice(0, 72).trimEnd() : "Update project files";
  return {
    subject: safeSubject,
    body: generated.body.trim(),
    ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
  };
}

function sanitizeProgressText(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length <= MAX_PROGRESS_TEXT_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_PROGRESS_TEXT_LENGTH).trimEnd();
}

interface CommitAndBranchSuggestion {
  subject: string;
  body: string;
  branch?: string | undefined;
  commitMessage: string;
  snapshot?: string;
}

interface FeatureBranchStepOptions {
  allowCommittedHead?: boolean;
  restoreOriginalBranchRef?: string | null;
}

function isCommitAction(
  action: GitStackedAction,
): action is "commit" | "commit_push" | "commit_push_pr" {
  return action === "commit" || action === "commit_push" || action === "commit_push_pr";
}

function formatCommitMessage(subject: string, body: string): string {
  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) {
    return subject;
  }
  return `${subject}\n\n${trimmedBody}`;
}

function parseCustomCommitMessage(raw: string): { subject: string; body: string } | null {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return null;
  }

  const [firstLine, ...rest] = normalized.split("\n");
  const subject = firstLine?.trim() ?? "";
  if (subject.length === 0) {
    return null;
  }

  return {
    subject,
    body: rest.join("\n").trim(),
  };
}

function extractBranchFromRef(ref: string): string {
  const normalized = ref.trim();

  if (normalized.startsWith("refs/remotes/")) {
    const withoutPrefix = normalized.slice("refs/remotes/".length);
    const firstSlash = withoutPrefix.indexOf("/");
    if (firstSlash === -1) {
      return withoutPrefix.trim();
    }
    return withoutPrefix.slice(firstSlash + 1).trim();
  }

  const firstSlash = normalized.indexOf("/");
  if (firstSlash === -1) {
    return normalized;
  }
  return normalized.slice(firstSlash + 1).trim();
}

function prioritizeRemoteNames(remoteNames: readonly string[]): string[] {
  const normalized = remoteNames
    .map((remoteName) => remoteName.trim())
    .filter((remoteName) => remoteName.length > 0);
  if (!normalized.includes("origin")) {
    return normalized;
  }
  return ["origin", ...normalized.filter((remoteName) => remoteName !== "origin")];
}

function appendUnique(values: string[], next: string | null | undefined): void {
  const trimmed = next?.trim() ?? "";
  if (trimmed.length === 0 || values.includes(trimmed)) {
    return;
  }
  values.push(trimmed);
}

function normalizePullRequestReference(reference: string): string {
  const trimmed = reference.trim();
  const hashNumber = /^#(\d+)$/.exec(trimmed);
  return hashNumber?.[1] ?? trimmed;
}

function canonicalizeExistingPath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return value;
  }
}

function shouldPreferSshRemote(url: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return trimmed.startsWith("git@") || trimmed.startsWith("ssh://");
}

function toPullRequestHeadRemoteInfo(pr: {
  isCrossRepository?: boolean;
  headRepositoryNameWithOwner?: string | null;
  headRepositoryOwnerLogin?: string | null;
}): PullRequestHeadRemoteInfo {
  return {
    ...(pr.isCrossRepository !== undefined ? { isCrossRepository: pr.isCrossRepository } : {}),
    ...(pr.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: pr.headRepositoryNameWithOwner }
      : {}),
    ...(pr.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: pr.headRepositoryOwnerLogin }
      : {}),
  };
}

function withInferredHeadRemoteInfo(
  pr: PullRequestInfo,
  inferred: PullRequestHeadRemoteInfo,
): PullRequestInfo {
  const reportedByGh =
    pr.isCrossRepository !== undefined ||
    pr.headRepositoryNameWithOwner !== undefined ||
    pr.headRepositoryOwnerLogin !== undefined;
  return reportedByGh ? pr : { ...pr, ...toPullRequestHeadRemoteInfo(inferred) };
}

function inferPullRequestHeadRemoteInfoFromSelector(
  headSelector: string,
  headContext: Pick<
    BranchHeadContext,
    | "headBranch"
    | "remoteName"
    | "headRepositoryNameWithOwner"
    | "headRepositoryOwnerLogin"
    | "isCrossRepository"
  >,
): PullRequestHeadRemoteInfo {
  const separatorIndex = headSelector.indexOf(":");
  if (separatorIndex > 0 && separatorIndex < headSelector.length - 1) {
    const selectorPrefix = headSelector.slice(0, separatorIndex);
    if (selectorPrefix === headContext.remoteName) {
      return {
        isCrossRepository: headContext.isCrossRepository,
        ...(headContext.headRepositoryNameWithOwner
          ? { headRepositoryNameWithOwner: headContext.headRepositoryNameWithOwner }
          : {}),
        ...(headContext.headRepositoryOwnerLogin
          ? { headRepositoryOwnerLogin: headContext.headRepositoryOwnerLogin }
          : {}),
      };
    }

    return {
      isCrossRepository: true,
      headRepositoryOwnerLogin: selectorPrefix,
    };
  }

  if (headContext.isCrossRepository && headSelector === headContext.headBranch) {
    return {
      isCrossRepository: true,
      ...(headContext.headRepositoryNameWithOwner
        ? { headRepositoryNameWithOwner: headContext.headRepositoryNameWithOwner }
        : {}),
      ...(headContext.headRepositoryOwnerLogin
        ? { headRepositoryOwnerLogin: headContext.headRepositoryOwnerLogin }
        : {}),
    };
  }

  return {};
}

export const makeGitManager = Effect.gen(function* () {
  const { handoffThread } = yield* GitHandoff;
  const gitCore = yield* GitCore;
  const gitHubCli = yield* GitHubCli;
  const textGeneration = yield* TextGeneration;
  const messageFlights = yield* makeKeyedSingleFlightCache<
    CommitMessageGenerationResult,
    TextGenerationError
  >({ maxEntries: 16, ttlMs: 10_000 });

  const createProgressEmitter = (
    input: { cwd: string; action: GitStackedAction },
    options?: GitRunStackedActionOptions,
  ) => {
    const actionId = options?.actionId ?? randomUUID();
    const reporter = options?.progressReporter;

    const emit = (event: GitActionProgressPayload) =>
      reporter
        ? reporter.publish({
            actionId,
            cwd: input.cwd,
            action: input.action,
            ...event,
          } as GitActionProgressEvent)
        : Effect.void;

    return {
      actionId,
      emit,
    };
  };

  const ensurePullRequestHeadRemote = (
    cwd: string,
    pullRequest: PullRequestHeadRemoteInfo,
    repositoryNameWithOwner: string,
  ) =>
    Effect.gen(function* () {
      const cloneUrls = yield* gitHubCli.getRepositoryCloneUrls({
        cwd,
        repository: repositoryNameWithOwner,
      });
      const originRemoteUrl = yield* gitCore.readConfigValue(cwd, "remote.origin.url");
      const remoteUrl = shouldPreferSshRemote(originRemoteUrl) ? cloneUrls.sshUrl : cloneUrls.url;
      const preferredRemoteName =
        pullRequest.headRepositoryOwnerLogin?.trim() ||
        repositoryNameWithOwner.split("/")[0]?.trim() ||
        "fork";
      return yield* gitCore.ensureRemote({
        cwd,
        preferredName: preferredRemoteName,
        url: remoteUrl,
      });
    });

  const configurePullRequestHeadUpstream = (
    cwd: string,
    pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
    localBranch = pullRequest.headBranch,
  ) =>
    Effect.gen(function* () {
      const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(pullRequest) ?? "";
      if (repositoryNameWithOwner.length === 0) {
        return;
      }

      const remoteName = yield* ensurePullRequestHeadRemote(
        cwd,
        pullRequest,
        repositoryNameWithOwner,
      );

      yield* gitCore.setBranchUpstream({
        cwd,
        branch: localBranch,
        remoteName,
        remoteBranch: pullRequest.headBranch,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          `GitManager.configurePullRequestHeadUpstream: failed to configure upstream for ${localBranch} -> ${pullRequest.headBranch} in ${cwd}: ${error.message}`,
        ).pipe(Effect.asVoid),
      ),
    );

  const materializePullRequestHeadBranch = (
    cwd: string,
    pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
    localBranch = pullRequest.headBranch,
  ) =>
    Effect.gen(function* () {
      const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(pullRequest) ?? "";

      if (repositoryNameWithOwner.length === 0) {
        yield* gitCore.fetchPullRequestBranch({
          cwd,
          prNumber: pullRequest.number,
          branch: localBranch,
        });
        return;
      }

      const remoteName = yield* ensurePullRequestHeadRemote(
        cwd,
        pullRequest,
        repositoryNameWithOwner,
      );

      yield* gitCore.fetchRemoteBranch({
        cwd,
        remoteName,
        remoteBranch: pullRequest.headBranch,
        localBranch,
      });
      yield* gitCore.setBranchUpstream({
        cwd,
        branch: localBranch,
        remoteName,
        remoteBranch: pullRequest.headBranch,
      });
    }).pipe(
      Effect.catch(() =>
        gitCore.fetchPullRequestBranch({
          cwd,
          prNumber: pullRequest.number,
          branch: localBranch,
        }),
      ),
    );
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

  const readConfigValueNullable = (cwd: string, key: string) =>
    gitCore.readConfigValue(cwd, key).pipe(Effect.catch(() => Effect.succeed(null)));

  const gitRefExists = (cwd: string, ref: string) =>
    gitCore
      .execute({
        operation: "GitManager.gitRefExists",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`],
        allowNonZeroExit: true,
        maxOutputBytes: 256,
      })
      .pipe(
        Effect.map((result) => result.code === 0),
        Effect.catch(() => Effect.succeed(false)),
      );

  const resolveRemoteRepositoryContext = (cwd: string, remoteName: string | null) =>
    Effect.gen(function* () {
      if (!remoteName) {
        return {
          repositoryNameWithOwner: null,
          ownerLogin: null,
        };
      }

      const remoteUrl = yield* readConfigValueNullable(cwd, `remote.${remoteName}.url`);
      const repositoryNameWithOwner = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remoteUrl);
      return {
        repositoryNameWithOwner,
        ownerLogin: parseRepositoryOwnerLogin(repositoryNameWithOwner),
      };
    });

  const resolveBranchHeadContext = (
    cwd: string,
    details: { branch: string; upstreamRef: string | null },
  ) =>
    Effect.gen(function* () {
      const remoteName = yield* readConfigValueNullable(cwd, `branch.${details.branch}.remote`);
      const headBranchFromUpstream = details.upstreamRef
        ? extractBranchFromRef(details.upstreamRef)
        : "";
      const headBranch =
        headBranchFromUpstream.length > 0 ? headBranchFromUpstream : details.branch;

      const [remoteRepository, originRepository] = yield* Effect.all(
        [
          resolveRemoteRepositoryContext(cwd, remoteName),
          resolveRemoteRepositoryContext(cwd, "origin"),
        ],
        { concurrency: "unbounded" },
      );

      const isCrossRepository =
        remoteRepository.repositoryNameWithOwner !== null &&
        originRepository.repositoryNameWithOwner !== null
          ? remoteRepository.repositoryNameWithOwner.toLowerCase() !==
            originRepository.repositoryNameWithOwner.toLowerCase()
          : remoteName !== null &&
            remoteName !== "origin" &&
            remoteRepository.repositoryNameWithOwner !== null;

      const ownerHeadSelector =
        remoteRepository.ownerLogin && headBranch.length > 0
          ? `${remoteRepository.ownerLogin}:${headBranch}`
          : null;
      const remoteAliasHeadSelector =
        remoteName && headBranch.length > 0 ? `${remoteName}:${headBranch}` : null;
      const shouldProbeRemoteOwnedSelectors = remoteName !== null;

      const headSelectors: string[] = [];
      if (isCrossRepository && shouldProbeRemoteOwnedSelectors) {
        appendUnique(headSelectors, ownerHeadSelector);
        appendUnique(
          headSelectors,
          remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null,
        );
        appendUnique(headSelectors, headBranch);
      }

      appendUnique(headSelectors, details.branch);
      if (!isCrossRepository) {
        appendUnique(headSelectors, headBranch !== details.branch ? headBranch : null);
      }
      if (!isCrossRepository && shouldProbeRemoteOwnedSelectors) {
        appendUnique(headSelectors, ownerHeadSelector);
        appendUnique(
          headSelectors,
          remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null,
        );
      }

      return {
        localBranch: details.branch,
        headBranch,
        headSelectors,
        preferredHeadSelector:
          ownerHeadSelector && isCrossRepository ? ownerHeadSelector : headBranch,
        remoteName,
        headRepositoryNameWithOwner: remoteRepository.repositoryNameWithOwner,
        headRepositoryOwnerLogin: remoteRepository.ownerLogin,
        isCrossRepository,
      } satisfies BranchHeadContext;
    });

  const findOpenPr = (
    cwd: string,
    headContext: Pick<
      BranchHeadContext,
      | "headSelectors"
      | "headBranch"
      | "remoteName"
      | "headRepositoryNameWithOwner"
      | "headRepositoryOwnerLogin"
      | "isCrossRepository"
    >,
  ) =>
    Effect.gen(function* () {
      for (const headSelector of headContext.headSelectors) {
        const pullRequests = yield* gitHubCli.listOpenPullRequests({
          cwd,
          headSelector,
          limit: OPEN_PR_LOOKUP_LIMIT,
        });
        const inferredHeadInfo = inferPullRequestHeadRemoteInfoFromSelector(
          headSelector,
          headContext,
        );

        for (const pullRequest of pullRequests) {
          const candidate = withInferredHeadRemoteInfo(
            toPullRequestInfo(pullRequest),
            inferredHeadInfo,
          );
          if (!matchesBranchHeadContext(candidate, headContext)) {
            continue;
          }

          return candidate;
        }
      }

      return null;
    });

  const findLatestPr = (cwd: string, details: { branch: string; upstreamRef: string | null }) =>
    Effect.gen(function* () {
      const headContext = yield* resolveBranchHeadContext(cwd, details);
      const parsedByNumber = new Map<number, PullRequestInfo>();

      for (const headSelector of headContext.headSelectors) {
        const inferredHeadInfo = inferPullRequestHeadRemoteInfoFromSelector(
          headSelector,
          headContext,
        );
        const pullRequests = yield* gitHubCli.listPullRequests({
          cwd,
          headSelector,
          limit: PR_LOOKUP_ALL_STATES_LIMIT,
          priority: "background",
        });

        for (const pullRequest of pullRequests) {
          const candidate = withInferredHeadRemoteInfo(
            toPullRequestInfo(pullRequest),
            inferredHeadInfo,
          );
          if (!matchesBranchHeadContext(candidate, headContext)) {
            continue;
          }
          parsedByNumber.set(candidate.number, candidate);
        }
      }

      const parsed = Array.from(parsedByNumber.values()).toSorted((a, b) => {
        const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return right - left;
      });

      const latestOpenPr = parsed.find((pr) => pr.state === "open");
      if (latestOpenPr) {
        return latestOpenPr;
      }
      return parsed[0] ?? null;
    });

  const resolveAlreadyExistingPullRequest = (
    cwd: string,
    error: unknown,
    headContext: BranchHeadContext,
  ) =>
    Effect.gen(function* () {
      const pullRequestUrl = extractPullRequestUrlFromError(error);
      if (pullRequestUrl) {
        const pullRequest = yield* gitHubCli
          .getPullRequest({ cwd, reference: pullRequestUrl })
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (pullRequest) {
          const candidate = toPullRequestInfo(pullRequest);
          if (candidate.state === "open" && matchesBranchHeadContext(candidate, headContext)) {
            return candidate;
          }
        }
      }

      // `gh pr create` can race with an existing-PR probe. Treat GitHub's create-time duplicate response
      // as success when the PR can be found.
      return yield* findOpenPr(cwd, headContext);
    });

  const resolveBaseBranch = (
    cwd: string,
    branch: string,
    upstreamRef: string | null,
    headContext: Pick<BranchHeadContext, "isCrossRepository">,
  ) =>
    Effect.gen(function* () {
      const configured = yield* gitCore.readConfigValue(cwd, `branch.${branch}.gh-merge-base`);
      if (configured) return configured;

      if (upstreamRef && !headContext.isCrossRepository) {
        const upstreamBranch = extractBranchFromRef(upstreamRef);
        if (upstreamBranch.length > 0 && upstreamBranch !== branch) {
          return upstreamBranch;
        }
      }

      const defaultFromGh = yield* gitHubCli
        .getDefaultBranch({ cwd })
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (defaultFromGh) {
        return defaultFromGh;
      }

      return "main";
    });

  const readCommitContext = (cwd: string, includeContent = true) => {
    const correlationId = randomUUID();
    const started = Date.now();
    return gitCore.prepareCommitContext(cwd, includeContent).pipe(
      Effect.tapError((error) =>
        Effect.logError("Git generation context failed", {
          correlationId,
          stage: error.operation,
          durationMs: Date.now() - started,
        }),
      ),
      Effect.mapError(
        (error) =>
          new GitCommandError({
            ...error,
            detail: `${error.detail} Retry generation. Reference: ${correlationId}`,
          }),
      ),
    );
  };

  const generateSuggestion = (
    input: {
      cwd: string;
      branch: string | null;
      includeBranch?: boolean;
    } & GitTextGenerationParams,
    context: import("../Services/GitCore").GitGenerationContext,
  ) =>
    Effect.gen(function* () {
      const correlationId = randomUUID();
      const started = Date.now();
      const style = yield* gitCore.execute({
        operation: "GitManager.commitStyle",
        cwd: input.cwd,
        args: ["log", "-5", "--format=%s"],
        maxOutputBytes: 600,
        outputMode: "prefix",
        allowNonZeroExit: true,
      });
      const generated = yield* messageFlights
        .get(
          JSON.stringify([
            input.cwd,
            context.snapshot,
            input.includeBranch ?? false,
            buildGitTextGenerationCallInput(input),
          ]),
          textGeneration.generateCommitMessage({
            cwd: input.cwd,
            branch: input.branch,
            stagedSummary:
              context.stagedSummary +
              (style.stdout ? `\nRecent subjects (style only):\n${style.stdout}` : ""),
            stagedPatch: context.stagedPatch,
            ...(input.includeBranch ? { includeBranch: true } : {}),
            ...buildGitTextGenerationCallInput(input),
          }),
        )
        .pipe(
          Effect.tapError((error) =>
            Effect.logError("Git message generation failed", {
              correlationId,
              stage: error.operation,
              provider: input.textGenerationModelSelection?.provider ?? "codex",
              model:
                input.textGenerationModelSelection?.model ?? input.textGenerationModel ?? "default",
              durationMs: Date.now() - started,
              fileCount: context.fileCount,
              contextBytes: Buffer.byteLength(context.stagedSummary + context.stagedPatch),
              incomplete: context.incomplete,
              scope: context.scope,
            }),
          ),
          Effect.mapError(
            (error) =>
              new TextGenerationError({
                operation: error.operation,
                detail: `${error.detail} Retry generation. Reference: ${correlationId}`,
                cause: error,
              }),
          ),
        );
      if (!generated.subject.trim())
        return yield* new TextGenerationError({
          operation: "structured-output",
          detail: `Provider returned an empty subject. Retry generation. Reference: ${correlationId}`,
        });
      const current = yield* readCommitContext(input.cwd, false);
      if (current?.snapshot !== context.snapshot)
        return yield* gitManagerError(
          "generateCommitMessage",
          "Changes or index changed during generation. Retry with the current selection.",
        );
      return sanitizeCommitMessage(generated);
    });

  const resolveCommitAndBranchSuggestion = (
    input: {
      cwd: string;
      branch: string | null;
      commitMessage?: string;

      includeBranch?: boolean;
      filePaths?: readonly string[];
    } & GitTextGenerationParams,
  ) =>
    Effect.gen(function* () {
      if (input.filePaths?.length) {
        const reset = yield* gitCore.execute({
          operation: "GitManager.stageSelection",
          cwd: input.cwd,
          args: ["reset"],
          allowNonZeroExit: true,
        });
        if (reset.code !== 0) {
          const head = yield* gitCore.execute({
            operation: "GitManager.stageSelection.head",
            cwd: input.cwd,
            args: ["rev-parse", "--verify", "HEAD"],
            allowNonZeroExit: true,
          });
          if (head.code === 0) return yield* gitManagerError("stageSelection", reset.stderr);
          yield* gitCore.execute({
            operation: "GitManager.stageSelection.unborn",
            cwd: input.cwd,
            args: ["rm", "--cached", "-r", "--ignore-unmatch", "."],
          });
        }
        yield* gitCore.stageFiles(input.cwd, input.filePaths);
      } else {
        yield* gitCore.execute({
          operation: "GitManager.stageAll",
          cwd: input.cwd,
          args: ["add", "-A"],
        });
      }
      const context = yield* readCommitContext(input.cwd);
      if (!context) {
        return null;
      }

      const customCommit = parseCustomCommitMessage(input.commitMessage ?? "");
      if (customCommit) {
        return {
          subject: customCommit.subject,
          body: customCommit.body,
          ...(input.includeBranch
            ? { branch: sanitizeFeatureBranchName(customCommit.subject) }
            : {}),
          commitMessage: formatCommitMessage(customCommit.subject, customCommit.body),
        };
      }

      const generated = yield* generateSuggestion(input, context);

      return {
        subject: generated.subject,
        body: generated.body,
        ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
        commitMessage: formatCommitMessage(generated.subject, generated.body),
        snapshot: context.snapshot,
      };
    });

  const runCommitStep = (
    cwd: string,
    action: "commit" | "commit_push" | "commit_push_pr",
    branch: string | null,
    commitMessage?: string,
    preResolvedSuggestion?: CommitAndBranchSuggestion,
    filePaths?: readonly string[],
    textGenerationParams?: GitTextGenerationParams,
    progressReporter?: GitActionProgressReporter,
    actionId?: string,
  ) =>
    Effect.gen(function* () {
      const emit = (event: GitActionProgressPayload) =>
        progressReporter && actionId
          ? progressReporter.publish({
              actionId,
              cwd,
              action,
              ...event,
            } as GitActionProgressEvent)
          : Effect.void;

      let suggestion: CommitAndBranchSuggestion | null | undefined = preResolvedSuggestion;
      if (!suggestion) {
        const needsGeneration = !commitMessage?.trim();
        if (needsGeneration) {
          yield* emit({
            kind: "phase_started",
            phase: "commit",
            label: "Generating commit message...",
          });
        }
        suggestion = yield* resolveCommitAndBranchSuggestion({
          cwd,
          branch,
          ...(commitMessage ? { commitMessage } : {}),
          ...(filePaths ? { filePaths } : {}),
          ...textGenerationParams,
        });
      }
      if (!suggestion) {
        return { status: "skipped_no_changes" as const };
      }

      if (suggestion.snapshot) {
        const current = yield* readCommitContext(cwd, false);
        if (current?.snapshot !== suggestion.snapshot)
          return yield* gitManagerError(
            "runCommitStep",
            "Index changed before commit. Review the current selection and retry.",
          );
      }

      yield* emit({
        kind: "phase_started",
        phase: "commit",
        label: "Committing...",
      });

      let currentHookName: string | null = null;
      const commitProgress =
        progressReporter && actionId
          ? {
              onOutputLine: ({ stream, text }: { stream: "stdout" | "stderr"; text: string }) => {
                const sanitized = sanitizeProgressText(text);
                if (!sanitized) {
                  return Effect.void;
                }
                return emit({
                  kind: "hook_output",
                  hookName: currentHookName,
                  stream,
                  text: sanitized,
                });
              },
              onHookStarted: (hookName: string) => {
                currentHookName = hookName;
                return emit({
                  kind: "hook_started",
                  hookName,
                });
              },
              onHookFinished: ({
                hookName,
                exitCode,
                durationMs,
              }: {
                hookName: string;
                exitCode: number | null;
                durationMs: number | null;
              }) => {
                if (currentHookName === hookName) {
                  currentHookName = null;
                }
                return emit({
                  kind: "hook_finished",
                  hookName,
                  exitCode,
                  durationMs,
                });
              },
            }
          : null;
      const { commitSha } = yield* gitCore.commit(cwd, suggestion.subject, suggestion.body, {
        timeoutMs: COMMIT_TIMEOUT_MS,
        ...(commitProgress ? { progress: commitProgress } : {}),
      });
      if (currentHookName !== null) {
        yield* emit({
          kind: "hook_finished",
          hookName: currentHookName,
          exitCode: 0,
          durationMs: null,
        });
        currentHookName = null;
      }
      return {
        status: "created" as const,
        commitSha,
        subject: suggestion.subject,
      };
    });

  const runPrStep = (
    cwd: string,
    fallbackBranch: string | null,
    textGenerationParams?: GitTextGenerationParams,
    prOptions?: {
      readonly title?: string | undefined;
      readonly body?: string | undefined;
      readonly draft?: boolean | undefined;
    },
  ) =>
    Effect.gen(function* () {
      const details = yield* gitCore.statusDetails(cwd);
      const branch = details.branch ?? fallbackBranch;
      if (!branch) {
        return yield* gitManagerError(
          "runPrStep",
          "Cannot create a pull request from detached HEAD.",
        );
      }
      if (!details.hasUpstream) {
        return yield* gitManagerError(
          "runPrStep",
          "Current branch has not been pushed. Push before creating a PR.",
        );
      }

      const headContext = yield* resolveBranchHeadContext(cwd, {
        branch,
        upstreamRef: details.upstreamRef,
      });

      const existing = yield* findOpenPr(cwd, headContext);
      if (existing) {
        return {
          status: "opened_existing" as const,
          url: existing.url,
          number: existing.number,
          baseBranch: existing.baseRefName,
          headBranch: existing.headRefName,
          title: existing.title,
        };
      }

      const baseBranch = yield* resolveBaseBranch(cwd, branch, details.upstreamRef, headContext);
      if (!headContext.isCrossRepository && baseBranch === headContext.headBranch) {
        return yield* gitManagerError(
          "runPrStep",
          `Cannot create a pull request from '${headContext.headBranch}' into itself. Create or switch to a feature branch and retry.`,
        );
      }
      let prTitle = prOptions?.title;
      let prBody = prOptions?.body;
      if (prTitle === undefined || prBody === undefined) {
        const rangeContext = yield* gitCore.readRangeContext(cwd, baseBranch);
        const originRemoteUrl = headContext.isCrossRepository
          ? yield* readConfigValueNullable(cwd, "remote.origin.url")
          : null;
        const targetRemoteName = headContext.isCrossRepository
          ? originRemoteUrl
            ? "origin"
            : null
          : headContext.remoteName;
        const remoteBaseRef = targetRemoteName
          ? `refs/remotes/${targetRemoteName}/${baseBranch}`
          : null;
        const useRemoteBaseRef =
          remoteBaseRef !== null && (yield* gitRefExists(cwd, remoteBaseRef));
        const prTemplateTreeish = useRemoteBaseRef ? remoteBaseRef : baseBranch;
        const prTemplate = Option.getOrUndefined(
          yield* detectPrTemplate(cwd, prTemplateTreeish, gitCore.execute),
        );

        const generated = yield* textGeneration.generatePrContent({
          cwd,
          baseBranch,
          headBranch: headContext.headBranch,
          commitSummary: rangeContext.commitSummary,
          diffSummary: rangeContext.diffSummary,
          diffPatch: rangeContext.diffPatch,
          ...(prTemplate !== undefined ? { prTemplate } : {}),
          ...buildGitTextGenerationCallInput(textGenerationParams ?? {}),
        });
        prTitle ??= generated.title;
        prBody ??= generated.body;
      }

      const bodyFile = path.join(tempDir, `glade-pr-body-${process.pid}-${randomUUID()}.md`);
      yield* fileSystem
        .writeFileString(bodyFile, prBody)
        .pipe(
          Effect.mapError((cause) =>
            gitManagerError("runPrStep", "Failed to write pull request body temp file.", cause),
          ),
        );
      const existingAfterCreateConflict = yield* gitHubCli
        .createPullRequest({
          cwd,
          baseBranch,
          headSelector: headContext.preferredHeadSelector,
          title: prTitle,
          bodyFile,
          ...(prOptions?.draft !== undefined ? { draft: prOptions.draft } : {}),
        })
        .pipe(
          Effect.as(null),
          Effect.catch((error) => {
            if (!isPullRequestAlreadyExistsError(error)) {
              return Effect.fail(error);
            }
            return resolveAlreadyExistingPullRequest(cwd, error, headContext);
          }),
          Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))),
        );
      if (existingAfterCreateConflict) {
        return {
          status: "opened_existing" as const,
          url: existingAfterCreateConflict.url,
          number: existingAfterCreateConflict.number,
          baseBranch: existingAfterCreateConflict.baseRefName,
          headBranch: existingAfterCreateConflict.headRefName,
          title: existingAfterCreateConflict.title,
        };
      }

      const created = yield* findOpenPr(cwd, headContext);
      if (!created) {
        return {
          status: "created" as const,
          baseBranch,
          headBranch: headContext.headBranch,
          title: prTitle,
        };
      }

      return {
        status: "created" as const,
        url: created.url,
        number: created.number,
        baseBranch: created.baseRefName,
        headBranch: created.headRefName,
        title: created.title,
      };
    });

  const pullRequestForBranch: GitManagerShape["pullRequestForBranch"] = Effect.fnUntraced(
    function* (input) {
      const latest = yield* findLatestPr(input.cwd, {
        branch: input.branch,
        upstreamRef: input.upstreamRef,
      });
      return latest ? toResolvedPullRequest(latest) : null;
    },
  );

  const status: GitManagerShape["status"] = Effect.fnUntraced(function* (input) {
    const details = yield* gitCore.statusDetails(input.cwd, { metadataOnly: true });

    const pr =
      details.branch !== null
        ? yield* pullRequestForBranch({
            cwd: input.cwd,
            branch: details.branch,
            upstreamRef: details.upstreamRef,
          }).pipe(
            Effect.catch((error) =>
              error._tag === "GitHubCliError" && error.reason === "rate-limited"
                ? Effect.fail(error)
                : Effect.succeed(null),
            ),
          )
        : null;

    return {
      branch: details.branch,
      hasWorkingTreeChanges: details.hasWorkingTreeChanges,
      workingTree: details.workingTree,
      hasUpstream: details.hasUpstream,
      upstreamBranch: details.upstreamBranch,
      configuredPrBaseBranch: details.configuredPrBaseBranch,
      aheadCount: details.aheadCount,
      behindCount: details.behindCount,
      pr,
    };
  });

  const readWorkingTreeDiff: GitManagerShape["readWorkingTreeDiff"] = Effect.fnUntraced(
    function* (input) {
      if (
        input.filePath !== undefined &&
        input.scope !== undefined &&
        input.scope !== "workingTree" &&
        input.scope !== "staged" &&
        input.scope !== "unstaged"
      ) {
        return yield* gitManagerError(
          "readWorkingTreeDiff",
          "File-scoped diffs are only supported for the working tree scope.",
        );
      }
      switch (input.scope) {
        case "ref": {
          const compareRef = input.compareRef?.trim() ?? "";
          if (compareRef.length === 0) {
            return yield* gitManagerError(
              "readWorkingTreeDiff",
              "A branch or commit is required to compare the working tree against.",
            );
          }
          return yield* gitCore.readRefPatch(input.cwd, compareRef);
        }
        case "branch":
          return yield* gitCore.readBranchPatch(input.cwd);
        case "staged":
          return yield* gitCore.readStagedPatch(input.cwd, input.filePath);
        case "unstaged":
          return yield* gitCore.readUnstagedPatch(input.cwd, input.filePath);
        case "workingTree":
        default:
          return yield* gitCore.readWorkingTreePatch(input.cwd, input.filePath);
      }
    },
  );

  const readSourceControlFiles: GitManagerShape["readSourceControlFiles"] = (
    cwd,
    query,
    reuseInventory,
  ) => gitCore.readSourceControlFiles(cwd, query, reuseInventory);

  const blameLine: GitManagerShape["blameLine"] = Effect.fnUntraced(function* (input) {
    return yield* gitCore.blameLine(input);
  });

  const readFileAtRev: GitManagerShape["readFileAtRev"] = Effect.fnUntraced(function* (input) {
    return yield* gitCore.readFileAtRev(input);
  });

  const readWorkingTreeDiffStats: GitManagerShape["readWorkingTreeDiffStats"] = Effect.fnUntraced(
    function* (input) {
      if (input.filePath !== undefined) {
        return yield* gitManagerError(
          "readWorkingTreeDiffStats",
          "File-scoped diff statistics are not supported.",
        );
      }
      if (input.scope === "ref") {
        const compareRef = input.compareRef?.trim() ?? "";
        if (compareRef.length === 0) {
          return yield* gitManagerError(
            "readWorkingTreeDiffStats",
            "A branch or commit is required to compare the working tree against.",
          );
        }
        return yield* gitCore.readDiffStats(input.cwd, "ref", compareRef);
      }
      return yield* gitCore.readDiffStats(
        input.cwd,
        input.scope ?? "workingTree",
        undefined,
        input.includeUntrackedFiles,
      );
    },
  );

  const generateCommitMessage: GitManagerShape["generateCommitMessage"] = Effect.fnUntraced(
    function* (input) {
      const context = yield* readCommitContext(input.cwd);
      if (!context)
        return yield* gitManagerError("generateCommitMessage", "There are no changes to describe.");
      const branch = yield* gitCore.readBranchContext(input.cwd);
      const message = yield* generateSuggestion({ ...input, branch: branch.branch }, context);
      return {
        message: formatCommitMessage(message.subject, message.body),
        snapshot: context.snapshot,
        scope: context.scope === "staged" ? ("staged" as const) : ("workingTree" as const),
      };
    },
  );

  const summarizeDiff: GitManagerShape["summarizeDiff"] = Effect.fnUntraced(function* (input) {
    const { patch, truncated } = yield* readWorkingTreeDiff({
      cwd: input.cwd,
      scope: input.scope,
    });
    if (patch.length === 0) {
      return yield* gitManagerError("summarizeDiff", "Cannot summarize an empty diff.");
    }
    if (truncated) {
      return yield* gitManagerError(
        "summarizeDiff",
        "Cannot summarize a truncated diff. Narrow the changes and try again.",
      );
    }

    const generated = yield* textGeneration.generateDiffSummary({
      cwd: input.cwd,
      patch,
      ...buildGitTextGenerationCallInput({
        textGenerationModel: input.textGenerationModel,
        textGenerationModelSelection: input.textGenerationModelSelection,
        codexHomePath: input.codexHomePath,
        providerOptions: input.providerOptions,
      }),
    });

    return {
      summary: generated.summary,
    };
  });

  const resolvePullRequest: GitManagerShape["resolvePullRequest"] = Effect.fnUntraced(
    function* (input) {
      const pullRequest = yield* gitHubCli
        .getPullRequest({
          cwd: input.cwd,
          reference: normalizePullRequestReference(input.reference),
        })
        .pipe(Effect.map((resolved) => toResolvedPullRequest(resolved)));

      return { pullRequest };
    },
  );

  const preparePullRequestThread: GitManagerShape["preparePullRequestThread"] = Effect.fnUntraced(
    function* (input) {
      const normalizedReference = normalizePullRequestReference(input.reference);
      const rootWorktreePath = canonicalizeExistingPath(input.cwd);
      const pullRequestSummary = yield* gitHubCli.getPullRequest({
        cwd: input.cwd,
        reference: normalizedReference,
      });
      const pullRequest = toResolvedPullRequest(pullRequestSummary);

      const ensureExistingWorktreeUpstream = (worktreePath: string, expectedBranch?: string) =>
        Effect.gen(function* () {
          const details = yield* gitCore.statusDetails(worktreePath);
          if (expectedBranch) {
            const remote = yield* readConfigValueNullable(
              worktreePath,
              `branch.${expectedBranch}.remote`,
            );
            const merge = yield* readConfigValueNullable(
              worktreePath,
              `branch.${expectedBranch}.merge`,
            );
            const actual = yield* resolveRemoteRepositoryContext(worktreePath, remote);
            const expected =
              resolveHeadRepositoryNameWithOwner(pullRequestWithRemoteInfo) ??
              (pullRequestSummary.isCrossRepository === false
                ? parseGitHubRepositoryNameWithOwnerFromRemoteUrl(
                    pullRequest.url.replace(/\/pull\/.*$/, ""),
                  )
                : null);
            if (
              details.branch !== expectedBranch ||
              !expected ||
              actual.repositoryNameWithOwner?.toLowerCase() !== expected.toLowerCase() ||
              merge !== `refs/heads/${pullRequest.headBranch}`
            ) {
              return yield* gitManagerError(
                "preparePullRequestThread",
                "The existing worktree does not have a verified remote for this pull request. Check its branch and upstream before retrying.",
              );
            }
          }
          yield* configurePullRequestHeadUpstream(
            worktreePath,
            {
              ...pullRequest,
              ...toPullRequestHeadRemoteInfo(pullRequestSummary),
            },
            details.branch ?? pullRequest.headBranch,
          );
        });

      const pullRequestWithRemoteInfo = {
        ...pullRequest,
        ...toPullRequestHeadRemoteInfo(pullRequestSummary),
      } as const;
      const localPullRequestBranch =
        resolvePullRequestWorktreeLocalBranchName(pullRequestWithRemoteInfo);

      const findLocalHeadBranch = (cwd: string) =>
        gitCore.listBranches({ cwd }).pipe(
          Effect.map((result) => {
            const localBranch = result.branches.find(
              (branch) => !branch.isRemote && branch.name === localPullRequestBranch,
            );
            if (localBranch) {
              return localBranch;
            }
            if (localPullRequestBranch === pullRequest.headBranch) {
              return null;
            }
            return (
              result.branches.find(
                (branch) =>
                  !branch.isRemote &&
                  branch.name === pullRequest.headBranch &&
                  branch.worktreePath !== null &&
                  canonicalizeExistingPath(branch.worktreePath) !== rootWorktreePath,
              ) ?? null
            );
          }),
        );

      const existingBranchBeforeFetch = yield* findLocalHeadBranch(input.cwd);
      const existingBranchBeforeFetchPath = existingBranchBeforeFetch?.worktreePath
        ? canonicalizeExistingPath(existingBranchBeforeFetch.worktreePath)
        : null;
      if (
        existingBranchBeforeFetch?.worktreePath &&
        existingBranchBeforeFetchPath !== rootWorktreePath
      ) {
        yield* ensureExistingWorktreeUpstream(
          existingBranchBeforeFetch.worktreePath,
          existingBranchBeforeFetch.name,
        );
        return {
          pullRequest,
          branch: existingBranchBeforeFetch.name,
          worktreePath: existingBranchBeforeFetch.worktreePath,
        };
      }
      if (input.mode === "local") {
        yield* gitHubCli.checkoutPullRequest({
          cwd: input.cwd,
          reference: normalizedReference,
          force: false,
        });
        const details = yield* gitCore.statusDetails(input.cwd, { metadataOnly: true });
        yield* configurePullRequestHeadUpstream(
          input.cwd,
          {
            ...pullRequest,
            ...toPullRequestHeadRemoteInfo(pullRequestSummary),
          },
          details.branch ?? pullRequest.headBranch,
        );
        return {
          pullRequest,
          branch: details.branch ?? pullRequest.headBranch,
          worktreePath: null,
        };
      }

      if (existingBranchBeforeFetchPath === rootWorktreePath) {
        return yield* gitManagerError(
          "preparePullRequestThread",
          "This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.",
        );
      }

      yield* materializePullRequestHeadBranch(
        input.cwd,
        pullRequestWithRemoteInfo,
        localPullRequestBranch,
      );

      const existingBranchAfterFetch = yield* findLocalHeadBranch(input.cwd);
      const existingBranchAfterFetchPath = existingBranchAfterFetch?.worktreePath
        ? canonicalizeExistingPath(existingBranchAfterFetch.worktreePath)
        : null;
      if (
        existingBranchAfterFetch?.worktreePath &&
        existingBranchAfterFetchPath !== rootWorktreePath
      ) {
        yield* ensureExistingWorktreeUpstream(
          existingBranchAfterFetch.worktreePath,
          existingBranchAfterFetch.name,
        );
        return {
          pullRequest,
          branch: existingBranchAfterFetch.name,
          worktreePath: existingBranchAfterFetch.worktreePath,
        };
      }
      if (existingBranchAfterFetchPath === rootWorktreePath) {
        return yield* gitManagerError(
          "preparePullRequestThread",
          "This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.",
        );
      }

      const worktree = yield* gitCore.createWorktree({
        cwd: input.cwd,
        branch: localPullRequestBranch,
        path: null,
      });
      yield* ensureExistingWorktreeUpstream(worktree.worktree.path);

      return {
        pullRequest,
        branch: worktree.worktree.branch,
        worktreePath: worktree.worktree.path,
      };
    },
  );

  const runFeatureBranchStep = (
    cwd: string,
    branch: string | null,
    commitMessage?: string,
    filePaths?: readonly string[],
    textGenerationParams?: GitTextGenerationParams,
    options?: FeatureBranchStepOptions,
  ) =>
    Effect.gen(function* () {
      const suggestion = yield* resolveCommitAndBranchSuggestion({
        cwd,
        branch,
        ...(commitMessage ? { commitMessage } : {}),
        ...(filePaths ? { filePaths } : {}),
        includeBranch: true,
        ...textGenerationParams,
      });
      if (!suggestion && !options?.allowCommittedHead) {
        return yield* gitManagerError(
          "runFeatureBranchStep",
          "Cannot create a feature branch because there are no changes to commit.",
        );
      }

      const existingBranchNames = yield* gitCore.listLocalBranchNames(cwd);
      const committedHeadBranchBase = yield* Effect.gen(function* () {
        if (suggestion) {
          return suggestion.branch ?? sanitizeFeatureBranchName(suggestion.subject);
        }
        const latestCommitSubject = yield* gitCore
          .execute({
            operation: "GitManager.runFeatureBranchStep.readHeadSubject",
            cwd,
            args: ["log", "-1", "--pretty=%s"],
          })
          .pipe(Effect.map((result) => result.stdout.trim().split(/\r?\n/g)[0]?.trim() ?? ""));
        if (latestCommitSubject.length > 0) {
          return latestCommitSubject;
        }
        return branch ? `${branch}-update` : undefined;
      });
      const resolvedBranch = resolveAutoFeatureBranchName(
        existingBranchNames,
        committedHeadBranchBase,
      );

      yield* gitCore.createBranch({ cwd, branch: resolvedBranch });
      yield* Effect.scoped(gitCore.checkoutBranch({ cwd, branch: resolvedBranch }));
      if (options?.restoreOriginalBranchRef && branch) {
        yield* gitCore.execute({
          operation: "GitManager.runFeatureBranchStep.restoreOriginalBranch",
          cwd,
          args: ["branch", "--force", branch, options.restoreOriginalBranchRef],
        });
      }

      return {
        branchStep: { status: "created" as const, name: resolvedBranch },
        resolvedCommitMessage: suggestion?.commitMessage,
        resolvedCommitSuggestion: suggestion ?? undefined,
      };
    });

  const resolveCommittedHeadRestoreRef = (
    cwd: string,
    details: { branch: string | null; upstreamRef: string | null },
  ) =>
    Effect.gen(function* () {
      if (!details.branch) {
        return null;
      }
      if (details.upstreamRef) {
        return details.upstreamRef;
      }

      const remoteNames = yield* gitCore
        .execute({
          operation: "GitManager.resolveCommittedHeadRestoreRef.listRemotes",
          cwd,
          args: ["remote"],
          allowNonZeroExit: true,
          timeoutMs: 5_000,
        })
        .pipe(Effect.map((result) => prioritizeRemoteNames(result.stdout.split(/\r?\n/g))));
      if (remoteNames.length > 1) {
        return yield* gitManagerError(
          "resolveCommittedHeadRestoreRef",
          `Cannot move committed work to a feature branch because '${details.branch}' has no upstream and this repository has multiple remotes. Push the branch first or configure its upstream before retrying.`,
        );
      }

      for (const remoteName of remoteNames) {
        const remoteRef = `${remoteName}/${details.branch}`;
        const remoteExists = yield* gitCore
          .execute({
            operation: "GitManager.resolveCommittedHeadRestoreRef.remoteExists",
            cwd,
            args: ["show-ref", "--verify", "--quiet", `refs/remotes/${remoteRef}`],
            allowNonZeroExit: true,
            timeoutMs: 5_000,
          })
          .pipe(Effect.map((result) => result.code === 0));
        if (!remoteExists) {
          continue;
        }

        yield* gitCore.execute({
          operation: "GitManager.resolveCommittedHeadRestoreRef.refreshRemoteBranch",
          cwd,
          args: [
            "fetch",
            "--quiet",
            "--no-tags",
            remoteName,
            `+refs/heads/${details.branch}:refs/remotes/${remoteRef}`,
          ],
          timeoutMs: 10_000,
        });
        return remoteRef;
      }

      return yield* gitManagerError(
        "resolveCommittedHeadRestoreRef",
        `Cannot move committed work to a feature branch because '${details.branch}' has no upstream or matching remote branch to restore.`,
      );
    });

  const runStackedAction: GitManagerShape["runStackedAction"] = Effect.fnUntraced(
    function* (input, options) {
      const progress = createProgressEmitter(input, options);
      let currentPhase: GitActionProgressPhase | null = null;

      const runAction = Effect.gen(function* () {
        const operation = yield* readGitOperation(input.cwd, gitCore.execute);
        if (operation.kind || operation.conflicts.length)
          return yield* gitManagerError(
            "runStackedAction",
            "Resolve the current Git operation or conflicts first.",
          );
        const initialStatus = yield* gitCore.statusDetails(input.cwd);
        const textGenerationParams: GitTextGenerationParams = {
          textGenerationModel: input.textGenerationModel,
          textGenerationModelSelection: input.textGenerationModelSelection,
          codexHomePath: input.codexHomePath,
          providerOptions: input.providerOptions,
        };
        const wantsCommit = isCommitAction(input.action);
        const wantsPush =
          input.action === "push" ||
          input.action === "commit_push" ||
          input.action === "commit_push_pr" ||
          (input.action === "create_pr" &&
            (input.featureBranch || !initialStatus.hasUpstream || initialStatus.aheadCount > 0));
        const wantsPr = input.action === "create_pr" || input.action === "commit_push_pr";
        const phases: GitActionProgressPhase[] = [
          ...(input.featureBranch ? (["branch"] as const) : []),
          ...(wantsCommit ? (["commit"] as const) : []),
          ...(wantsPush ? (["push"] as const) : []),
          ...(wantsPr ? (["pr"] as const) : []),
        ];

        yield* progress.emit({
          kind: "action_started",
          phases,
        });

        if (
          input.action === "push" &&
          initialStatus.hasWorkingTreeChanges &&
          !input.allowDirtyWorkingTree
        ) {
          return yield* gitManagerError(
            "runStackedAction",
            "Commit or stash local changes before pushing.",
          );
        }
        if (
          input.action === "create_pr" &&
          initialStatus.hasWorkingTreeChanges &&
          !input.allowDirtyWorkingTree
        ) {
          return yield* gitManagerError(
            "runStackedAction",
            "Commit local changes before creating a PR.",
          );
        }
        if (!input.featureBranch && wantsPush && !initialStatus.branch) {
          return yield* gitManagerError("runStackedAction", "Cannot push from detached HEAD.");
        }
        if (!input.featureBranch && wantsPr && !initialStatus.branch) {
          return yield* gitManagerError(
            "runStackedAction",
            "Cannot create a pull request from detached HEAD.",
          );
        }
        const committedHeadRestoreRef =
          input.featureBranch && !wantsCommit
            ? yield* resolveCommittedHeadRestoreRef(input.cwd, {
                branch: initialStatus.branch,
                upstreamRef: initialStatus.upstreamRef,
              })
            : null;

        let branchStep: { status: "created" | "skipped_not_requested"; name?: string };
        let commitMessageForStep =
          input.commitMessage?.trim() ||
          (input.action === "commit_push_pr" ? input.prTitle?.trim() : undefined);
        let preResolvedCommitSuggestion: CommitAndBranchSuggestion | undefined = undefined;

        if (input.featureBranch) {
          currentPhase = "branch";
          yield* progress.emit({
            kind: "phase_started",
            phase: "branch",
            label: "Preparing feature branch...",
          });
          const result = yield* runFeatureBranchStep(
            input.cwd,
            initialStatus.branch,
            commitMessageForStep,
            input.filePaths,
            textGenerationParams,
            {
              allowCommittedHead: !wantsCommit,
              restoreOriginalBranchRef: committedHeadRestoreRef,
            },
          );
          branchStep = result.branchStep;
          commitMessageForStep = result.resolvedCommitMessage;
          preResolvedCommitSuggestion = result.resolvedCommitSuggestion;
        } else {
          branchStep = { status: "skipped_not_requested" as const };
        }

        const currentBranch = branchStep.name ?? initialStatus.branch;
        const commitAction = isCommitAction(input.action) ? input.action : null;
        const commit = commitAction
          ? yield* Effect.gen(function* () {
              currentPhase = "commit";
              return yield* runCommitStep(
                input.cwd,
                commitAction,
                currentBranch,
                commitMessageForStep,
                preResolvedCommitSuggestion,
                input.filePaths,
                textGenerationParams,
                options?.progressReporter,
                progress.actionId,
              );
            })
          : { status: "skipped_not_requested" as const };

        const push = wantsPush
          ? yield* progress
              .emit({
                kind: "phase_started",
                phase: "push",
                label: "Pushing...",
              })
              .pipe(
                Effect.flatMap(() =>
                  Effect.gen(function* () {
                    currentPhase = "push";
                    return yield* gitCore.pushCurrentBranch(
                      input.cwd,
                      currentBranch,
                      input.allowIntegration,
                    );
                  }),
                ),
              )
          : { status: "skipped_not_requested" as const };

        const pr = wantsPr
          ? yield* progress
              .emit({
                kind: "phase_started",
                phase: "pr",
                label: "Creating PR...",
              })
              .pipe(
                Effect.flatMap(() =>
                  Effect.gen(function* () {
                    currentPhase = "pr";
                    return yield* runPrStep(input.cwd, currentBranch, textGenerationParams, {
                      title: input.prTitle,
                      body: input.prBody,
                      draft: input.prDraft,
                    });
                  }),
                ),
              )
          : { status: "skipped_not_requested" as const };

        const result = {
          action: input.action,
          branch: branchStep,
          commit,
          push,
          pr,
        };
        yield* progress.emit({
          kind: "action_finished",
          result,
        });
        return result;
      });

      return yield* runAction.pipe(
        Effect.catch((error) =>
          progress
            .emit({
              kind: "action_failed",
              phase: currentPhase,
              message: error.message,
            })
            .pipe(Effect.flatMap(() => Effect.fail(error))),
        ),
      );
    },
  );

  return {
    status,
    pullRequestForBranch,
    readWorkingTreeDiff,
    readSourceControlFiles,
    readWorkingTreeDiffStats,
    blameLine,
    readFileAtRev,
    summarizeDiff,
    generateCommitMessage,
    resolvePullRequest,
    preparePullRequestThread: (input) =>
      gitCore.withMutation(input.cwd, preparePullRequestThread(input)),
    handoffThread: (input) => gitCore.withMutation(input.cwd, handoffThread(input)),
    runStackedAction: (input, options) =>
      gitCore.withMutation(input.cwd, runStackedAction(input, options)),
  } satisfies GitManagerShape;
});

export const GitManagerLive = Layer.effect(GitManager, makeGitManager).pipe(
  Layer.provide(GitHandoffLive),
);
