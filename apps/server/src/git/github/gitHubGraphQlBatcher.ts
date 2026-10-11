import { Deferred, Effect, Exit, Schema, Scope } from "effect";

import { GitHubError } from "../Errors.ts";
import type { GitHubHttp } from "./gitHubHttp.ts";
import type { GitHubPriority } from "./gitHubRateLimits.ts";

export interface AliasedQuery<K, V> {
  readonly operation: string;
  /** Requests arriving within this window share one document. */
  readonly windowMs: number;
  readonly maxPerDocument: number;
  readonly keyId: (key: K) => string;
  /** Selection for one alias; every value must come in through `variables`, never the query text. */
  readonly selection: (alias: string, variable: (name: string) => string) => string;
  readonly variables: (
    key: K,
  ) => Record<string, { readonly type: string; readonly value: unknown }>;
  readonly parse: (data: unknown, key: K) => V;
}

interface Pending<K, V> {
  readonly key: K;
  priority: GitHubPriority;
  readonly waiters: Array<Deferred.Deferred<V, GitHubError>>;
}

interface AliasedBatcher<K, V> {
  readonly load: (key: K, priority: GitHubPriority) => Effect.Effect<V, GitHubError>;
}

function buildDocument<K, V>(query: AliasedQuery<K, V>, keys: ReadonlyArray<K>) {
  const definitions: string[] = [];
  const variables: Record<string, unknown> = {};
  const selections = keys.map((key, index) => {
    const alias = `q${index}`;
    for (const [name, spec] of Object.entries(query.variables(key))) {
      definitions.push(`$${alias}_${name}: ${spec.type}`);
      variables[`${alias}_${name}`] = spec.value;
    }
    return query.selection(alias, (name) => `$${alias}_${name}`);
  });
  return {
    text: `query(${definitions.join(", ")}) {\n${selections.join("\n")}\n}`,
    variables,
  };
}

export const makeAliasedBatcher = <K, V>(http: GitHubHttp, query: AliasedQuery<K, V>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make("parallel");
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    let pending = new Map<string, Pending<K, V>>();
    let scheduled = false;

    const runDocument = (entries: ReadonlyArray<Pending<K, V>>) => {
      const document = buildDocument(
        query,
        entries.map((entry) => entry.key),
      );
      const priority = entries.some((entry) => entry.priority === "foreground")
        ? "foreground"
        : "background";
      return http
        .graphql({
          operation: query.operation,
          query: document.text,
          variables: document.variables,
          priority,
        })
        .pipe(
          Effect.flatMap((data) =>
            Effect.forEach(entries, (entry, index) => {
              const aliasData = (data as Record<string, unknown> | null)?.[`q${index}`];
              let exit: Exit.Exit<V, GitHubError>;
              try {
                exit = Exit.succeed(query.parse(aliasData, entry.key));
              } catch (cause) {
                exit = Exit.fail(
                  Schema.is(GitHubError)(cause)
                    ? cause
                    : new GitHubError({
                        operation: query.operation,
                        reason: "not-found",
                        detail: `GitHub returned no result: ${cause instanceof Error ? cause.message : String(cause)}`,
                      }),
                );
              }
              return Effect.forEach(entry.waiters, (waiter) => Deferred.done(waiter, exit), {
                discard: true,
              });
            }),
          ),
        );
    };

    const settleAll = (entries: ReadonlyArray<Pending<K, V>>, error: GitHubError) =>
      Effect.forEach(
        entries.flatMap((entry) => entry.waiters),
        (waiter) => Deferred.fail(waiter, error),
        { discard: true },
      );

    const flushChunk = (entries: ReadonlyArray<Pending<K, V>>): Effect.Effect<void> =>
      runDocument(entries).pipe(
        Effect.catch((error) =>
          // One read per key would only spend what a rate-limit pause is saving.
          entries.length === 1 || error.reason === "rate-limited"
            ? settleAll(entries, error)
            : Effect.forEach(entries, (entry) => flushChunk([entry]), {
                concurrency: 2,
                discard: true,
              }),
        ),
      );

    const flush = Effect.gen(function* () {
      yield* Effect.sleep(query.windowMs);
      const entries = [...pending.values()];
      pending = new Map();
      scheduled = false;
      const chunks: Array<Array<Pending<K, V>>> = [];
      for (let index = 0; index < entries.length; index += query.maxPerDocument) {
        chunks.push(entries.slice(index, index + query.maxPerDocument));
      }
      yield* Effect.forEach(chunks, flushChunk, { concurrency: 4, discard: true });
    });

    const load = (key: K, priority: GitHubPriority) =>
      Effect.gen(function* () {
        const waiter = yield* Deferred.make<V, GitHubError>();
        const id = query.keyId(key);
        const existing = pending.get(id);
        if (existing) {
          existing.waiters.push(waiter);
          if (priority === "foreground") existing.priority = "foreground";
        } else {
          pending.set(id, { key, priority, waiters: [waiter] });
        }
        if (!scheduled) {
          scheduled = true;
          yield* Effect.forkIn(flush, scope);
        }
        return yield* Deferred.await(waiter);
      });

    return { load } satisfies AliasedBatcher<K, V>;
  });
