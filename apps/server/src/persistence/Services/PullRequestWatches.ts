import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { PersistenceSqlError } from "../Errors.ts";

export interface PullRequestWatchRecord {
  readonly threadId: string;
  readonly cwd: string;
  readonly number: number;
  readonly startedAt: string;
  readonly lastEvent: string | null;
  /** Opaque to persistence; owned by the watch evaluation. */
  readonly stateJson: string;
}

export interface PullRequestWatchRepositoryShape {
  readonly list: Effect.Effect<ReadonlyArray<PullRequestWatchRecord>, PersistenceSqlError>;
  readonly get: (
    threadId: string,
  ) => Effect.Effect<PullRequestWatchRecord | null, PersistenceSqlError>;
  readonly upsert: (
    record: PullRequestWatchRecord & { readonly updatedAt: string },
  ) => Effect.Effect<void, PersistenceSqlError>;
  /** Applies only while the same watch (`startedAt`) is still on, so a stop is never undone. */
  readonly update: (input: {
    readonly threadId: string;
    readonly startedAt: string;
    readonly lastEvent: string | null;
    readonly stateJson: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void, PersistenceSqlError>;
  readonly remove: (threadId: string) => Effect.Effect<void, PersistenceSqlError>;
}

export class PullRequestWatchRepository extends ServiceMap.Service<
  PullRequestWatchRepository,
  PullRequestWatchRepositoryShape
>()("glade/persistence/Services/PullRequestWatches/PullRequestWatchRepository") {}
