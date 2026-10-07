import { DESKTOP_HOST_RPC_MAX_FRAME_BYTES } from "@glade/contracts/desktopHost/desktopHostRpc";

const HEADER_BYTES = 4;

export class FrameTooLargeError extends Error {}

export function encodeFrame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.byteLength > DESKTOP_HOST_RPC_MAX_FRAME_BYTES) {
    throw new FrameTooLargeError(`Frame of ${payload.byteLength} bytes exceeds the limit.`);
  }
  const header = Buffer.allocUnsafe(HEADER_BYTES);
  header.writeUInt32BE(payload.byteLength, 0);
  return Buffer.concat([header, payload]);
}

// Accumulates socket chunks and yields complete JSON messages. A frame whose declared length
// exceeds the cap throws before its body is buffered, so a peer cannot make us hold it.
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    while (this.buffer.byteLength >= HEADER_BYTES) {
      const length = this.buffer.readUInt32BE(0);
      if (length > DESKTOP_HOST_RPC_MAX_FRAME_BYTES) {
        throw new FrameTooLargeError(`Frame of ${length} bytes exceeds the limit.`);
      }
      if (this.buffer.byteLength < HEADER_BYTES + length) break;
      const body = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + length).toString("utf8");
      this.buffer = this.buffer.subarray(HEADER_BYTES + length);
      messages.push(JSON.parse(body));
    }
    return messages;
  }
}
