import { useLocalStorage } from "~/hooks/useLocalStorage";
import { Schema } from "effect";
import { normalizeHandle } from "./profileFormatting";

const PROFILE_HANDLE_STORAGE_KEY = "glade:profile:handle:v1";

const StoredHandleSchema = Schema.String;

export function useProfileHandle(defaultHandle: string) {
  const [stored, setStored] = useLocalStorage(PROFILE_HANDLE_STORAGE_KEY, "", StoredHandleSchema);

  const handle = stored.trim().length > 0 ? normalizeHandle(stored) : defaultHandle;

  const setHandle = (next: string) => {
    const normalized = normalizeHandle(next);

    setStored(normalized === defaultHandle ? "" : normalized);
  };

  const resetHandle = () => setStored("");

  return { handle, setHandle, resetHandle, isSelectedHint: stored.trim().length > 0 } as const;
}
