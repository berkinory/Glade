const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const PNG_IHDR = [0x49, 0x48, 0x44, 0x52] as const;

const PNG_HEADER_BYTES = 24;

export interface PngDimensions {
  readonly width: number;
  readonly height: number;
}

export function pngDimensions(bytes: Uint8Array): PngDimensions | null {
  if (bytes.byteLength < PNG_HEADER_BYTES) return null;
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null;
  if (!PNG_IHDR.every((byte, index) => bytes[12 + index] === byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}
