import { useEffect, useEffectEvent, useState } from "react";
import { cn } from "~/lib/utils";

let activeDecoders = 0;
const waitingDecoders: { signal: AbortSignal; start: () => void; abort: () => void }[] = [];

function reserveDecoder(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const request = {
      signal,
      start: () => {
        signal.removeEventListener("abort", request.abort);
        activeDecoders += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          activeDecoders -= 1;
          waitingDecoders.shift()?.start();
        });
      },
      abort: () => {
        const index = waitingDecoders.indexOf(request);
        if (index >= 0) waitingDecoders.splice(index, 1);
        reject(new DOMException("Thumbnail cancelled", "AbortError"));
      },
    };
    if (signal.aborted) {
      request.abort();
      return;
    }
    if (activeDecoders < 2) {
      request.start();
      return;
    }
    if (waitingDecoders.length >= 16) {
      reject(new Error("Thumbnail queue is full"));
      return;
    }
    waitingDecoders.push(request);
    signal.addEventListener("abort", request.abort, { once: true });
  });
}

export function LocalVideoThumbnail(props: {
  url: string;
  alt: string;
  className?: string;
  onReady?: (() => void) | undefined;
  onError?: (() => void) | undefined;
}) {
  const [frame, setFrame] = useState<{ url: string; image: string | null; failed: boolean } | null>(
    null,
  );
  const reportReady = useEffectEvent(() => props.onReady?.());
  const reportError = useEffectEvent(() => props.onError?.());
  const url = props.url;
  useEffect(() => {
    const controller = new AbortController();
    let releaseSlot: (() => void) | undefined;
    let disposed = false;
    let settled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    const release = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      releaseSlot?.();
    };
    const fail = () => {
      if (disposed || settled) return;
      settled = true;
      clearTimeout(timer);
      controller.abort();
      setFrame({ url, image: null, failed: true });
      release();
      reportError();
    };
    const timer = setTimeout(fail, 10_000);
    const capture = () => {
      if (disposed || settled || !video.videoWidth || !video.videoHeight) return;
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      try {
        const context = canvas.getContext("2d");
        if (!context) {
          fail();
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL("image/jpeg", 0.85);
        settled = true;
        clearTimeout(timer);
        setFrame({ url, image, failed: false });
        release();
        reportReady();
      } catch {
        fail();
      }
      canvas.width = 0;
      canvas.height = 0;
    };
    video.onloadeddata = capture;
    video.onseeked = capture;
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.1, Number.isFinite(video.duration) ? video.duration / 2 : 0);
    };
    video.onerror = fail;
    void reserveDecoder(controller.signal).then((release) => {
      releaseSlot = release;
      if (disposed || settled) {
        release();
        return;
      }
      video.src = url;
      video.load();
    }, fail);
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      video.onloadeddata = null;
      video.onseeked = null;
      video.onloadedmetadata = null;
      video.onerror = null;
      release();
    };
  }, [url]);
  const current = frame?.url === props.url ? frame : null;
  return (
    <div className={cn("local-image-preview", props.className)}>
      {current?.image ? (
        <img
          src={current.image}
          alt={props.alt}
          className="local-image-preview__img max-h-[calc(100vh-13rem)]"
        />
      ) : (
        <p className="text-ui-sm text-muted-foreground">
          {current?.failed
            ? "Video thumbnail unavailable. The format may be unsupported or the file may exceed the preview limit."
            : "Loading video thumbnail…"}
        </p>
      )}
    </div>
  );
}
