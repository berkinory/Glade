import { makeSocketUrl } from "../wsTransport";

export type FrameSourceResetReason = "closed" | "error" | "decode-failed";

export interface WebSocketLike {
  binaryType: string;
  readonly readyState?: number;
  readonly send: (data: string) => void;
  readonly close: () => void;
  readonly addEventListener: (
    type: "message" | "close" | "error" | "open",
    listener: (event: never) => void,
  ) => void;
}

interface BinaryFrameSourceOptions<Frame> {
  readonly streamId: string;
  readonly streamIdParam: string;
  readonly wsPath: string;
  readonly resyncMessage: string;
  readonly handlers: {
    readonly onFrame: (frame: Frame) => void;
    // The pane resets its decoder because the next connection starts a new stream generation with its
    // own parameter sets.
    readonly onReset: (reason: FrameSourceResetReason) => void;
  };

  readonly createSocket?: (url: string) => WebSocketLike;
  readonly explicitUrl?: string | null;
  readonly decode: (
    bytes: Uint8Array,
  ) =>
    | { readonly ok: true; readonly frame: Frame }
    | { readonly ok: false; readonly reason: unknown };

  readonly now?: () => number;
  // Rebuilding a capture session is expensive (the device route tears down and recreates a
  // VideoToolbox encoder; the computer route re-primes compositor capture), so a gate that fires on
  // every dropped frame must not be allowed to thrash it.
  readonly resyncCooldownMs: number;
}

export interface BinaryFrameSource {
  readonly requestResync: () => boolean;

  readonly close: () => void;
}

// Frames are lossy, high-rate, and useless the moment they are late, which is the opposite of
// everything the Effect RPC feature socket carries. They ride a dedicated binary WebSocket so a
// frame burst can never delay an RPC response or a domain-event push, and so a slow consumer drops
// frames instead of stalling the control plane. The subscription is the URL, so frames start with
// no handshake message.
function binaryFrameSocketUrl(input: {
  readonly streamId: string;
  readonly streamIdParam: string;
  readonly wsPath: string;
  readonly explicitUrl?: string | null;
}): string {
  const url = new URL(makeSocketUrl(input.explicitUrl ?? null, input.wsPath));
  url.searchParams.set(input.streamIdParam, input.streamId);
  return url.toString();
}

export function createBinaryFrameSource<Frame>(
  options: BinaryFrameSourceOptions<Frame>,
): BinaryFrameSource {
  const url = binaryFrameSocketUrl({
    streamId: options.streamId,
    streamIdParam: options.streamIdParam,
    wsPath: options.wsPath,
    ...(options.explicitUrl !== undefined ? { explicitUrl: options.explicitUrl } : {}),
  });
  const socket = (options.createSocket ?? defaultCreateSocket)(url);
  socket.binaryType = "arraybuffer";

  const now = options.now ?? (() => Date.now());
  let closed = false;
  let open = false;
  let lastResyncAt: number | null = null;

  let resyncPending = false;

  const reset = (reason: FrameSourceResetReason) => {
    if (closed) return;
    options.handlers.onReset(reason);
  };

  const sendResync = (): boolean => {
    if (closed) return false;
    try {
      socket.send(JSON.stringify({ type: options.resyncMessage }));
      return true;
    } catch {
      return false;
    }
  };

  socket.addEventListener("open", (() => {
    open = true;
    if (!resyncPending) return;
    resyncPending = false;
    sendResync();
  }) as (event: never) => void);

  socket.addEventListener("message", ((event: { data: unknown }) => {
    if (closed) return;
    const bytes = frameBytes(event.data);

    if (!bytes) return;

    const result = options.decode(bytes);
    if (!result.ok) {
      reset("decode-failed");
      return;
    }
    options.handlers.onFrame(result.frame);
  }) as (event: never) => void);

  socket.addEventListener("close", (() => reset("closed")) as (event: never) => void);
  socket.addEventListener("error", (() => reset("error")) as (event: never) => void);

  return {
    requestResync: () => {
      if (closed) return false;
      const at = now();
      if (lastResyncAt !== null && at - lastResyncAt < options.resyncCooldownMs) {
        return false;
      }
      lastResyncAt = at;
      if (!open) {
        resyncPending = true;
        return false;
      }
      return sendResync();
    },
    close: () => {
      if (closed) return;
      closed = true;
      resyncPending = false;
      try {
        socket.close();
      } catch {}
    },
  };
}

function frameBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

function defaultCreateSocket(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}
