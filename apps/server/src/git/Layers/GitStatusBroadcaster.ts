import { realpathSync } from "node:fs";

import { Effect, Layer, PubSub, RcMap, Ref, Schedule, Stream } from "effect";
import type {
  GitStatusLocalResult,
  GitStatusRemoteResult,
  GitStatusResult,
  GitStatusStreamEvent,
} from "@glade/contracts/git/git";
import { mergeGitStatusParts } from "@glade/shared/git/git";

import { GitCore } from "../Services/GitCore";
import { GitManager } from "../Services/GitManager";
import {
  GitStatusBroadcaster,
  type GitStatusBroadcasterShape,
} from "../Services/GitStatusBroadcaster";
import {
  canReuseCachedRemoteStatus,
  type CachedGitStatus,
  isCachedRemoteStatusFresh,
  makeCachedStatusValue,
  setCachedGitStatus,
  splitLocalStatus,
  splitLocalStatusDetails,
  splitRemoteStatus,
  splitRemoteStatusDetails,
} from "../gitStatusCache";

import { watchGitRepository } from "../gitRepositoryChanges";

interface GitStatusChange {
  readonly cwd: string;
  readonly event: GitStatusStreamEvent;
}

function normalizeCwd(cwd: string): string {
  try {
    return realpathSync.native(cwd);
  } catch {
    return cwd;
  }
}

export const GitStatusBroadcasterLive = Layer.effect(
  GitStatusBroadcaster,
  Effect.gen(function* () {
    const gitCore = yield* GitCore;
    const gitManager = yield* GitManager;
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<GitStatusChange>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );
    const cacheRef = yield* Ref.make(new Map<string, CachedGitStatus>());

    const getCachedStatus = (cwd: string) =>
      Ref.get(cacheRef).pipe(Effect.map((cache) => cache.get(cwd) ?? null));

    const updateCachedLocalStatus = (
      cwd: string,
      local: GitStatusLocalResult,
      options?: {
        readonly publish?: boolean;
        readonly force?: boolean;
        readonly repositoryChanged?: boolean;
      },
    ) =>
      Effect.gen(function* () {
        const nextLocal = makeCachedStatusValue(local);
        const shouldPublish = yield* Ref.modify(cacheRef, (cache) => {
          const previous = cache.get(cwd) ?? { local: null, remote: null };
          const nextCache = setCachedGitStatus(cache, cwd, { ...previous, local: nextLocal });
          return [previous.local?.fingerprint !== nextLocal.fingerprint, nextCache] as const;
        });

        if (options?.publish && (shouldPublish || options.force)) {
          yield* PubSub.publish(changesPubSub, {
            cwd,
            event: {
              _tag: "localUpdated",
              local,
              repositoryChanged: options?.repositoryChanged ?? false,
            },
          });
        }

        return local;
      });

    const updateCachedRemoteStatus = (
      cwd: string,
      remote: GitStatusRemoteResult | null,
      options?: { readonly publish?: boolean; readonly force?: boolean },
    ) =>
      Effect.gen(function* () {
        const nextRemote = makeCachedStatusValue(remote);
        const shouldPublish = yield* Ref.modify(cacheRef, (cache) => {
          const previous = cache.get(cwd) ?? { local: null, remote: null };
          const nextCache = setCachedGitStatus(cache, cwd, { ...previous, remote: nextRemote });
          return [previous.remote?.fingerprint !== nextRemote.fingerprint, nextCache] as const;
        });

        if (options?.publish && (shouldPublish || options.force)) {
          yield* PubSub.publish(changesPubSub, {
            cwd,
            event: { _tag: "remoteUpdated", remote },
          });
        }

        return remote;
      });

    const loadStatus = (
      cwd: string,
      options?: { readonly publish?: boolean; readonly force?: boolean },
    ) =>
      Effect.gen(function* () {
        const status = yield* gitManager.status({ cwd });
        const local = yield* updateCachedLocalStatus(cwd, splitLocalStatus(status), options);
        const remote = yield* updateCachedRemoteStatus(cwd, splitRemoteStatus(status), options);
        return mergeGitStatusParts(local, remote) as GitStatusResult;
      });

    const getStatus: GitStatusBroadcasterShape["getStatus"] = (input) =>
      Effect.gen(function* () {
        const normalizedCwd = normalizeCwd(input.cwd);
        const cached = yield* getCachedStatus(normalizedCwd);
        // Only probe git for details when the cached remote metadata could still be reused. `statusDetails`
        // spawns several git subprocesses, and a full status load runs it again, so probing against expired
        // cache state would double the git work on every poll (the sidebar polls at 60 s against a 30 s
        // TTL, so the reuse check could never pass on that path).
        if (cached?.remote && isCachedRemoteStatusFresh({ cached })) {
          const details = yield* gitCore.statusDetails(normalizedCwd, { metadataOnly: true });
          if (canReuseCachedRemoteStatus({ cached, details })) {
            const local = yield* updateCachedLocalStatus(
              normalizedCwd,
              splitLocalStatusDetails(details),
            );
            const remote = splitRemoteStatusDetails(details, cached.remote.value);
            return mergeGitStatusParts(local, remote) as GitStatusResult;
          }
        }
        return yield* loadStatus(normalizedCwd);
      });

    const refreshStatus: GitStatusBroadcasterShape["refreshStatus"] = (cwd) =>
      loadStatus(normalizeCwd(cwd), { publish: true });

    const refreshWatchedStatus = (cwd: string, repositoryChanged = false) => {
      const normalizedCwd = normalizeCwd(cwd);
      return Effect.gen(function* () {
        const details = yield* gitCore.statusDetails(normalizedCwd, {
          refreshUpstream: false,
          metadataOnly: true,
        });
        const local = yield* updateCachedLocalStatus(
          normalizedCwd,
          splitLocalStatusDetails(details),
          { publish: true, force: true, repositoryChanged },
        );
        const cached = yield* getCachedStatus(normalizedCwd);
        if (cached?.remote)
          yield* updateCachedRemoteStatus(
            normalizedCwd,
            splitRemoteStatusDetails(details, cached.remote.value),
            { publish: true },
          );
        return local;
      });
    };

    const fullSubscribers = new Map<string, number>();
    const watchers = yield* RcMap.make({
      lookup: (cwd: string) =>
        watchGitRepository(cwd, gitCore.execute).pipe(
          Stream.tapError((error) =>
            Effect.logWarning("Repository watcher failed; retrying", error),
          ),
          Stream.retry(Schedule.spaced("5 seconds")),
          Stream.runForEach(({ repositoryChanged }) =>
            Effect.gen(function* () {
              if (fullSubscribers.has(cwd)) yield* refreshWatchedStatus(cwd, repositoryChanged);
              const summary = yield* gitCore.summary(cwd);
              yield* PubSub.publish(changesPubSub, {
                cwd,
                event: { _tag: "summaryUpdated", summary },
              });
            }).pipe(
              Effect.catch((error) => Effect.logWarning("Watched Git refresh failed", error)),
            ),
          ),
          Effect.forkScoped,
        ),
    });

    const streamStatus: GitStatusBroadcasterShape["streamStatus"] = (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const normalizedCwd = normalizeCwd(input.cwd);
          const subscription = yield* PubSub.subscribe(changesPubSub);
          if (!input.summaryOnly)
            yield* Effect.acquireRelease(
              Effect.sync(() =>
                fullSubscribers.set(normalizedCwd, (fullSubscribers.get(normalizedCwd) ?? 0) + 1),
              ),
              () =>
                Effect.sync(() => {
                  const remaining = (fullSubscribers.get(normalizedCwd) ?? 1) - 1;
                  if (remaining > 0) fullSubscribers.set(normalizedCwd, remaining);
                  else fullSubscribers.delete(normalizedCwd);
                }),
            );
          yield* RcMap.get(watchers, normalizedCwd);
          const snapshot: GitStatusStreamEvent = input.summaryOnly
            ? { _tag: "summaryUpdated", summary: yield* gitCore.summary(normalizedCwd) }
            : yield* getStatus({ cwd: normalizedCwd }).pipe(
                Effect.map((status) => ({
                  _tag: "snapshot" as const,
                  local: splitLocalStatus(status),
                  remote: splitRemoteStatus(status),
                })),
              );

          return Stream.concat(
            Stream.make(snapshot),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((change) => change.cwd === normalizedCwd),
              Stream.map((change) => change.event),
              Stream.filter((event) =>
                input.summaryOnly
                  ? event._tag === "summaryUpdated"
                  : event._tag !== "summaryUpdated",
              ),
            ),
          );
        }),
      );

    return {
      getStatus,
      refreshLocalStatus: (cwd) => refreshWatchedStatus(cwd, false),
      refreshStatus,
      streamStatus,
    } satisfies GitStatusBroadcasterShape;
  }),
);
