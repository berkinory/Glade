import type { ThreadId } from "@glade/contracts";
import { useEffect, useRef, useState } from "react";

import { useComputerStateStore } from "../../computerStateStore";

const COMPUTER_PREVIEW_TAP_QUIET_MS = 1_000;

export interface ComputerPreviewTapFrameSize {
  readonly width: number;
  readonly height: number;
}

function isImageBitmapAvailable(): boolean {
  return typeof Blob === "function" && typeof globalThis.createImageBitmap === "function";
}

export function useComputerPreviewTap(input: {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly threadId?: ThreadId | undefined;
  readonly enabled: boolean;
}): { readonly active: boolean; readonly frameSize: ComputerPreviewTapFrameSize | null } {
  const { canvasRef, enabled, threadId } = input;
  const [active, setActive] = useState(false);
  const [frameSize, setFrameSize] = useState<ComputerPreviewTapFrameSize | null>(null);
  const generationRef = useRef(0);
  // The tap is host-wide, so in a split with two live leaves both cards would otherwise draw the same
  // frame.
  const isDrivingThread = useComputerStateStore((store) => {
    if (threadId === undefined) return true;
    const threadState = store.threadStatesByThreadId[threadId];
    if (!threadState) return true;

    if (threadState.sharedPreviewUnavailable) return false;
    return (
      threadState.controlOwnerThreadId === threadId ||
      (threadState.agentActive && !threadState.controlledByOtherThread)
    );
  });
  const [pageVisible, setPageVisible] = useState(
    () => typeof document !== "undefined" && document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    update();
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const onFrame = window.desktopBridge?.computerPreview?.onFrame;
    if (
      !enabled ||
      !pageVisible ||
      !isDrivingThread ||
      typeof onFrame !== "function" ||
      !isImageBitmapAvailable()
    ) {
      setActive(false);
      return;
    }

    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    let disposed = false;
    let decoding = false;
    let lastSeq: number | null = null;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;

    const noteDecoded = () => {
      setActive(true);
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        if (!isCurrent() || disposed) return;
        setActive(false);
      }, COMPUTER_PREVIEW_TAP_QUIET_MS);
    };

    const decodeFrame = async (jpeg: Uint8Array): Promise<void> => {
      if (!isCurrent() || disposed) return;
      decoding = true;
      let bitmap: ImageBitmap | null = null;
      try {
        const payload = jpeg as Uint8Array<ArrayBuffer>;
        bitmap = await globalThis.createImageBitmap(new Blob([payload], { type: "image/jpeg" }));
        if (!isCurrent() || disposed) return;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }

        context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);

        const { width, height } = bitmap;
        setFrameSize((previous) =>
          previous?.width === width && previous.height === height ? previous : { width, height },
        );
        noteDecoded();
      } catch {
      } finally {
        bitmap?.close();
        decoding = false;
      }
    };

    const unsubscribe = onFrame((frame) => {
      if (!isCurrent() || disposed) return;
      if (typeof frame.seq !== "number" || !Number.isFinite(frame.seq)) return;

      if (lastSeq !== null && frame.seq <= lastSeq) return;
      lastSeq = frame.seq;
      if (decoding) return;
      void decodeFrame(frame.jpeg);
    });

    return () => {
      disposed = true;
      generationRef.current += 1;
      if (quietTimer !== null) clearTimeout(quietTimer);
      unsubscribe();

      setFrameSize(null);
    };
  }, [canvasRef, enabled, pageVisible, threadId, isDrivingThread]);

  return { active, frameSize };
}
