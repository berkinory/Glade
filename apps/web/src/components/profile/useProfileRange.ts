import { Schema } from "effect";
import { useLocalStorage } from "~/hooks/useLocalStorage";

const PROFILE_RANGE_STORAGE_KEY = "glade:profile:range:v1";

export const ProfileRange = Schema.Literals(["month", "all"]);
export type ProfileRange = typeof ProfileRange.Type;

export function useProfileRange() {
  return useLocalStorage<ProfileRange, ProfileRange>(
    PROFILE_RANGE_STORAGE_KEY,
    "month",
    ProfileRange,
  );
}
