export interface JpegDimensions {
  readonly width: number;
  readonly height: number;
}

const JPEG_SOI = [0xff, 0xd8] as const;

const isStandaloneMarker = (marker: number) =>
  marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);

const isStartOfFrame = (marker: number) =>
  (marker >= 0xc0 && marker <= 0xc3) ||
  (marker >= 0xc5 && marker <= 0xc7) ||
  (marker >= 0xc9 && marker <= 0xcb) ||
  (marker >= 0xcd && marker <= 0xcf);

export function jpegDimensions(bytes: Uint8Array): JpegDimensions | null {
  if (bytes.byteLength < 4) return null;
  if (bytes[0] !== JPEG_SOI[0] || bytes[1] !== JPEG_SOI[1]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1]!;
    while (marker === 0xff && offset + 2 < bytes.byteLength) {
      offset += 1;
      marker = bytes[offset + 1]!;
    }
    if (isStandaloneMarker(marker)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.byteLength) return null;
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      if (offset + 9 > bytes.byteLength) return null;
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }

    if (marker === 0xda) return null;
    offset += 2 + length;
  }
  return null;
}
