import { type ReactNode, useState } from "react";
import { cn } from "~/lib/utils";

export function LocalMediaPlayer(props: {
  kind: "video" | "audio";
  url: string;
  label: string;
  unplayable: ReactNode;
  className?: string;
  onReady?: (() => void) | undefined;
  onError?: (() => void) | undefined;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === props.url) return props.unplayable;
  const handlers = {
    onLoadedMetadata: () => props.onReady?.(),
    onError: () => {
      setFailedUrl(props.url);
      props.onError?.();
    },
  };
  if (props.kind === "audio") {
    return (
      <div className={cn("flex items-center justify-center p-6", props.className)}>
        <audio
          src={props.url}
          aria-label={props.label}
          controls
          preload="metadata"
          className="w-full max-w-xl"
          {...handlers}
        />
      </div>
    );
  }
  return (
    <div className={cn("local-image-preview", props.className)}>
      {/* The #t fragment makes the idle element paint a real frame instead of a black first frame. */}
      <video
        src={`${props.url}#t=0.1`}
        aria-label={props.label}
        controls
        playsInline
        preload="metadata"
        className="local-image-preview__img max-h-[calc(100vh-13rem)]"
        {...handlers}
      />
    </div>
  );
}
