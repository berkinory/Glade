export class ByteAccumulator {
  private readonly chunks: Buffer[] = [];
  private length = 0;

  get byteLength(): number {
    return this.length;
  }

  append(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    this.chunks.push(Buffer.from(chunk));
    this.length += chunk.byteLength;
  }

  readUInt32LE(offset: number): number {
    if (offset < 0 || offset + 4 > this.length) {
      throw new RangeError("Byte accumulator u32 read is out of range");
    }
    const first = this.chunks[0];
    if (first && first.byteLength >= offset + 4) return first.readUInt32LE(offset);
    return (
      (this.byteAt(offset) |
        (this.byteAt(offset + 1) << 8) |
        (this.byteAt(offset + 2) << 16) |
        (this.byteAt(offset + 3) << 24)) >>>
      0
    );
  }

  take(byteLength: number): Buffer {
    const first = this.chunks[0];
    if (first && first.byteLength >= byteLength) {
      this.skip(byteLength);
      return first.subarray(0, byteLength);
    }
    this.checkRange(byteLength);
    const taken = Buffer.concat(this.chunks, byteLength);
    this.skip(byteLength);
    return taken;
  }

  skip(byteLength: number): void {
    this.checkRange(byteLength);
    let remaining = byteLength;
    while (remaining > 0) {
      const chunk = this.chunks[0]!;
      if (chunk.byteLength <= remaining) {
        this.chunks.shift();
        remaining -= chunk.byteLength;
      } else {
        this.chunks[0] = chunk.subarray(remaining);
        remaining = 0;
      }
    }
    this.length -= byteLength;
  }

  clear(): void {
    this.chunks.length = 0;
    this.length = 0;
  }

  private checkRange(byteLength: number): void {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > this.length) {
      throw new RangeError("Byte accumulator range is out of bounds");
    }
  }

  private byteAt(index: number): number {
    let offset = index;
    for (const chunk of this.chunks) {
      if (offset < chunk.byteLength) return chunk[offset]!;
      offset -= chunk.byteLength;
    }
    throw new RangeError("Byte accumulator index is out of range");
  }
}
