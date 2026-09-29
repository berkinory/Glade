import type {
  OrchestrationProject,
  OrchestrationProjectShell,
  ProjectId,
  PullRequestDetail,
} from "@glade/contracts";
import { isValidGitHubRepositoryNameWithOwner } from "@glade/shared/githubRepository";
import { Effect, Layer, Scope, Semaphore } from "effect";

import { GitCore } from "../../git/Services/GitCore";
import { GitHubCli, type GitHubCliShape } from "../../git/Services/GitHubCli";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { makeKeyedSingleFlightCache } from "../KeyedSingleFlightCache";
import { PullRequestService, type PullRequestServiceShape } from "../Services/PullRequestService";
import { resolveGitHubRepositories, type GitHubRepositoryInventory } from "../repositoryResolution";
import { makePullRequestOperations } from "../pullRequestOperations";

const GITHUB_REPOSITORY_CACHE_MAX_ENTRIES = 256;
const PULL_REQUEST_MERGE_CAPABILITIES_CACHE_MAX_ENTRIES = 64;

interface PullRequestServiceDependencies {
  readonly github: GitHubCliShape;
  readonly listProjects: () => Effect.Effect<ReadonlyArray<OrchestrationProject>, unknown>;
  readonly resolveRepositories: (
    project: OrchestrationProject,
  ) => Effect.Effect<GitHubRepositoryInventory, unknown>;
}

/** The shell snapshot excludes deleted projects, so the omitted field is known to be null. */
function liveProjectFromShell(shell: OrchestrationProjectShell): OrchestrationProject {
  return { ...shell, deletedAt: null };
}

const makePullRequestService = (
  dependencies: PullRequestServiceDependencies,
): Effect.Effect<PullRequestServiceShape, never, Scope.Scope> =>
  Effect.gen(function* () {
    const githubReadSlots = yield* Semaphore.make(6);
    const withGitHubRead = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      githubReadSlots.withPermits(1)(effect);
    const repositoryCache = yield* makeKeyedSingleFlightCache<GitHubRepositoryInventory, unknown>({
      maxEntries: GITHUB_REPOSITORY_CACHE_MAX_ENTRIES,
      ttlMs: 30_000,
    });
    const mergeCapabilitiesCache = yield* makeKeyedSingleFlightCache<
      PullRequestDetail["mergeCapabilities"],
      unknown
    >({ maxEntries: PULL_REQUEST_MERGE_CAPABILITIES_CACHE_MAX_ENTRIES, ttlMs: 5 * 60_000 });

    const findProject = (projectId: ProjectId) =>
      dependencies.listProjects().pipe(
        Effect.flatMap((allProjects) => {
          const project = allProjects.find(
            (candidate) =>
              candidate.id === projectId &&
              candidate.kind === "project" &&
              candidate.deletedAt === null,
          );
          return project ? Effect.succeed(project) : Effect.fail(new Error("Project not found."));
        }),
      );

    const validateProjectRepository = (project: OrchestrationProject, repositoryInput: string) =>
      Effect.gen(function* () {
        const repository = repositoryInput.trim();
        if (!isValidGitHubRepositoryNameWithOwner(repository)) {
          return yield* Effect.fail(new Error("Invalid GitHub repository identity."));
        }
        const inventory = yield* repositoryCache.get(
          project.workspaceRoot,
          dependencies.resolveRepositories(project),
        );
        if (!inventory.authoritative) {
          return yield* Effect.fail(new Error("GitHub repository inventory is unavailable."));
        }
        const matched = inventory.repositories.find(
          (candidate) => candidate.nameWithOwner.toLowerCase() === repository.toLowerCase(),
        );
        if (!matched) {
          return yield* Effect.fail(
            new Error("GitHub repository does not belong to the selected project."),
          );
        }
        return matched.nameWithOwner;
      });

    const loadMergeCapabilities = (cwd: string, repository: string) =>
      mergeCapabilitiesCache.get(
        repository.toLowerCase(),
        withGitHubRead(dependencies.github.getRepositoryMergeCapabilities({ cwd, repository })),
      );

    return makePullRequestOperations({
      github: dependencies.github,
      findProject,
      validateProjectRepository,
      loadMergeCapabilities,
      withGitHubRead,
    });
  });

export const PullRequestServiceLive = Layer.effect(
  PullRequestService,
  Effect.gen(function* () {
    const git = yield* GitCore;
    const github = yield* GitHubCli;
    const projection = yield* ProjectionSnapshotQuery;
    return yield* makePullRequestService({
      github,
      listProjects: () =>
        projection
          .getShellSnapshot()
          .pipe(Effect.map((snapshot) => snapshot.projects.map(liveProjectFromShell))),
      resolveRepositories: (project) => resolveGitHubRepositories(git, project.workspaceRoot),
    });
  }),
);
