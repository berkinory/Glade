import { useState } from "react";
import { cn } from "~/lib/utils";

export function LocalVideoPlayer(props: {
  url: string;
  label: string;
  className?: string;
  onReady?: (() => void) | undefined;
  onError?: (() => void) | undefined;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <div className={cn("local-image-preview", props.className)}>
      {failedUrl === props.url ? (
        <p className="text-ui-sm text-muted-foreground">
          This video could not be played. The format may be unsupported.
        </p>
      ) : (
        // The #t fragment makes the idle element paint a real frame instead of a black first frame.
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
      )}
    </div>
  );
}
