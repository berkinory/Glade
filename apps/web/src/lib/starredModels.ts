import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { Schema } from "effect";

import { isProviderKind } from "../providerOrdering";

export const STARRED_MODELS_STORAGE_KEY = "glade:starred-models:v1";

const StarredModelSchema = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  effort: Schema.NullOr(Schema.String),
  fastMode: Schema.NullOr(Schema.Boolean),
  thinking: Schema.NullOr(Schema.Boolean),
});
export const StarredModelsSchema = Schema.Array(StarredModelSchema);

export interface StarredModel {
  readonly provider: ProviderKind;
  readonly model: string;
  readonly effort: string | null;
  readonly fastMode: boolean | null;
  readonly thinking: boolean | null;
}

export type StoredStarredModel = typeof StarredModelSchema.Type;

export function starredModelKey(
  entry: Pick<StoredStarredModel, "provider" | "model" | "effort" | "fastMode" | "thinking">,
): string {
  return JSON.stringify([
    entry.provider,
    entry.model,
    entry.effort ?? "",
    entry.fastMode === null ? "" : String(entry.fastMode),
    entry.thinking === null ? "" : String(entry.thinking),
  ]);
}

export function starredModelSlotKey(entry: Pick<StoredStarredModel, "provider" | "model">): string {
  return JSON.stringify([entry.provider, entry.model]);
}

export function normalizeStarredModels(
  stored: ReadonlyArray<StoredStarredModel>,
): ReadonlyArray<StarredModel> {
  const seen = new Set<string>();
  const result: StarredModel[] = [];
  for (const entry of stored) {
    if (!isProviderKind(entry.provider) || entry.model.trim().length === 0) continue;
    const key = starredModelKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...entry, provider: entry.provider });
  }
  return result;
}

export function toggleStarredModel(
  current: ReadonlyArray<StoredStarredModel>,
  entry: StarredModel,
): StoredStarredModel[] {
  const key = starredModelKey(entry);
  const normalized = normalizeStarredModels(current);
  return normalized.some((candidate) => starredModelKey(candidate) === key)
    ? normalized.filter((candidate) => starredModelKey(candidate) !== key)
    : [...normalized, entry];
}

export function unstarModel(
  current: ReadonlyArray<StoredStarredModel>,
  entry: Pick<StoredStarredModel, "provider" | "model">,
): StoredStarredModel[] {
  const slot = starredModelSlotKey(entry);
  return normalizeStarredModels(current).filter(
    (candidate) => starredModelSlotKey(candidate) !== slot,
  );
}

function readStoredStarredModels(): ReadonlyArray<StarredModel> {
  try {
    const raw = globalThis.localStorage?.getItem(STARRED_MODELS_STORAGE_KEY);
    if (!raw) return [];
    return normalizeStarredModels(
      Schema.decodeUnknownSync(StarredModelsSchema)(JSON.parse(raw) as unknown),
    );
  } catch {
    return [];
  }
}

export function readStarredModelSlugs(provider: ProviderKind): string[] {
  const starred = readStoredStarredModels()
    .filter((entry) => entry.provider === provider)
    .map((entry) => entry.model);
  return Array.from(new Set(starred));
}
