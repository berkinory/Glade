import { cn } from "~/lib/utils";
import { DitherIdenticon } from "./DitherIdenticon";

export function ProfileAvatar({
  seed,
  color,
  image,
  className,
}: {
  readonly seed: string;
  readonly color: string;
  readonly image?: string | null;
  readonly className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-full bg-muted/60", className)}>
      {image ? (
        <img src={image} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        <DitherIdenticon seed={seed} color={color} className="size-full" />
      )}
    </div>
  );
}
