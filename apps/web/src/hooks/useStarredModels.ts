import {
  normalizeStarredModels,
  STARRED_MODELS_STORAGE_KEY,
  type StarredModel,
  StarredModelsSchema,
  toggleStarredModel,
  unstarModel,
} from "~/lib/starredModels";
import { useLocalStorage } from "./useLocalStorage";

export function useStarredModels(): {
  starredModels: ReadonlyArray<StarredModel>;
  toggleStarredModel: (entry: StarredModel) => void;
  unstarModel: (entry: Pick<StarredModel, "provider" | "model">) => void;
} {
  const [stored, setStored] = useLocalStorage(STARRED_MODELS_STORAGE_KEY, [], StarredModelsSchema);
  return {
    starredModels: normalizeStarredModels(stored),
    toggleStarredModel: (entry) => setStored((current) => toggleStarredModel(current, entry)),
    unstarModel: (entry) => setStored((current) => unstarModel(current, entry)),
  };
}
