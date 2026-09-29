import { ProviderListModelsResult } from "@glade/contracts";
import { Cause, Effect, FileSystem, Schema } from "effect";
import * as path from "node:path";

import { writeFileStringAtomically } from "../atomicWrite";

export interface PersistedModelCatalogEntry {
  readonly key: string;
  readonly result: ProviderListModelsResult;
  readonly storedAt: number;
}

const PersistedModelCatalogs = Schema.Struct({
  version: Schema.Literal(1),
  entries: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      result: ProviderListModelsResult,
      storedAt: Schema.Number,
    }),
  ),
});

const decodePersistedModelCatalogs = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PersistedModelCatalogs),
);

export function resolveProviderModelCatalogCachePath(input: { readonly stateDir: string }): string {
  return path.join(input.stateDir, "provider-models", "catalogs.json");
}

export const readProviderModelCatalogCache = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return [];
    }

    const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return [];
    }

    return yield* decodePersistedModelCatalogs(trimmed).pipe(
      Effect.map((persisted) => persisted.entries),
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          Effect.logWarning("failed to parse provider model catalog cache, ignoring", {
            path: filePath,
            issues: Cause.pretty(cause),
          }).pipe(Effect.as([])),
        onSuccess: Effect.succeed,
      }),
    );
  });

export const writeProviderModelCatalogCache = (input: {
  readonly filePath: string;
  readonly entries: ReadonlyArray<PersistedModelCatalogEntry>;
}) =>
  writeFileStringAtomically({
    filePath: input.filePath,
    contents: `${JSON.stringify({ version: 1, entries: input.entries }, null, 2)}\n`,
  });
