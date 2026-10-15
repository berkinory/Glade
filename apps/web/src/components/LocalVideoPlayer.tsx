import { type ReactNode, useState } from "react";
import { cn } from "~/lib/utils";

export function LocalVideoPlayer(props: {
  url: string;
  label: string;
  unplayable: ReactNode;
  className?: string;
  onReady?: (() => void) | undefined;
  onError?: (() => void) | undefined;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === props.url) return props.unplayable;
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
        onLoadedMetadata={() => props.onReady?.()}
        onError={() => {
          setFailedUrl(props.url);
          props.onError?.();
        }}
      />
    </div>
  );
}
