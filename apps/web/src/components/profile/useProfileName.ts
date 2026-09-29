import { Schema } from "effect";
import { useLocalStorage } from "~/hooks/useLocalStorage";

const PROFILE_NAME_STORAGE_KEY = "glade:profile:name:v1";

const StoredNameSchema = Schema.String;

export function useProfileName(defaultName: string) {
  const [stored, setStored] = useLocalStorage(PROFILE_NAME_STORAGE_KEY, "", StoredNameSchema);

  const name = stored.trim().length > 0 ? stored.trim() : defaultName;

  const setName = (next: string) => {
    const trimmed = next.trim();
    setStored(trimmed === defaultName ? "" : trimmed);
  };

  return { name, setName } as const;
}
