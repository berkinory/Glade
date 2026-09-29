import { Schema } from "effect";
import { useLocalStorage } from "~/hooks/useLocalStorage";

const PROFILE_AVATAR_IMAGE_STORAGE_KEY = "glade:profile:avatarImage:v1";

const StoredImageSchema = Schema.String;

export function useProfileAvatarImage() {
  const [stored, setStored] = useLocalStorage(
    PROFILE_AVATAR_IMAGE_STORAGE_KEY,
    "",
    StoredImageSchema,
  );

  const image = stored.trim().length > 0 ? stored : null;

  const setImage = (next: string | null) => {
    setStored(next ?? "");
  };

  return { image, setImage } as const;
}
