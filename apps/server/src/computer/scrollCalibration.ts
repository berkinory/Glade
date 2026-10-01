// Clients convert scroll units differently without reporting the ratio. Learn actual travel from
// before/after images.
import { setImmediate as yieldToIO } from "node:timers/promises";
import { inflate } from "node:zlib";
import { promisify } from "node:util";

// The async form dispatches to the libuv threadpool: a multi-megapixel capture's inflate must not
// stall the event loop the frame publisher and every RPC response share.
const inflateAsync = promisify(inflate);

export interface LumaImage {
  readonly width: number;
  readonly height: number;
  readonly luma: Uint8Array;
}

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const CHANNELS_BY_COLOR_TYPE = new Map<number, number>([
  [0, 1],
  [2, 3],
  [6, 4],
]);

const decodedCaptures = new WeakMap<Uint8Array, Promise<LumaImage | undefined>>();

// Decode failure means unknown travel, not a failed scroll: the input was already delivered.
export function decodePngLuma(bytes: Uint8Array): Promise<LumaImage | undefined> {
  let decoded = decodedCaptures.get(bytes);
  if (!decoded) {
    decoded = decodePng(bytes).catch(() => undefined);
    decodedCaptures.set(bytes, decoded);
  }
  return decoded;
}

async function decodePng(bytes: Uint8Array): Promise<LumaImage | undefined> {
  if (bytes.length < PNG_SIGNATURE.length) return undefined;
  for (const [index, byte] of PNG_SIGNATURE.entries()) {
    if (bytes[index] !== byte) return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  let header: { width: number; height: number; channels: number } | undefined;
  const idatParts: Uint8Array[] = [];
  let idatBytes = 0;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > bytes.length) return undefined;
    if (type === "IHDR") {
      if (length !== 13) return undefined;
      const width = view.getUint32(dataStart);
      const height = view.getUint32(dataStart + 4);
      const bitDepth = bytes[dataStart + 8]!;
      const colorType = bytes[dataStart + 9]!;
      const interlace = bytes[dataStart + 12]!;
      const channels = CHANNELS_BY_COLOR_TYPE.get(colorType);
      if (bitDepth !== 8 || channels === undefined || interlace !== 0) return undefined;
      if (width === 0 || height === 0) return undefined;
      header = { width, height, channels };
    } else if (type === "IDAT") {
      idatParts.push(bytes.subarray(dataStart, dataEnd));
      idatBytes += length;
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!header || idatBytes === 0) return undefined;
  const compressed = concat(idatParts, idatBytes);
  const raw = await inflateAsync(compressed);
  return unfilterToLuma(raw, header.width, header.height, header.channels);
}

function concat(parts: readonly Uint8Array[], totalBytes: number): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const merged = new Uint8Array(totalBytes);
  let at = 0;
  for (const part of parts) {
    merged.set(part, at);
    at += part.length;
  }
  return merged;
}

// The previous row is kept unfiltered because every filter but None and Sub refers back to it.
async function unfilterToLuma(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: number,
): Promise<LumaImage | undefined> {
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return undefined;
  const luma = new Uint8Array(width * height);
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  let at = 0;
  const rowsPerSlice = Math.max(1, Math.floor(65_536 / stride));

  for (let row = 0; row < height; row += 1) {
    if (row > 0 && row % rowsPerSlice === 0) await yieldToIO();
    const filter = raw[at]!;
    at += 1;
    current.set(raw.subarray(at, at + stride));
    at += stride;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? current[index - channels]! : 0;
      const up = previous[index]!;
      const upLeft = index >= channels ? previous[index - channels]! : 0;
      const value = current[index]!;
      switch (filter) {
        case 0:
          break;
        case 1:
          current[index] = (value + left) & 0xff;
          break;
        case 2:
          current[index] = (value + up) & 0xff;
          break;
        case 3:
          current[index] = (value + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          current[index] = (value + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          return undefined;
      }
    }
    const rowStart = row * width;
    for (let column = 0; column < width; column += 1) {
      const sample = column * channels;
      luma[rowStart + column] =
        channels === 1
          ? current[sample]!
          : (current[sample]! * 299 + current[sample + 1]! * 587 + current[sample + 2]! * 114) /
            1000;
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return { width, height, luma };
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

export interface VerticalTravelOptions {
  readonly maxShift?: number;
}

const PROFILE_COLUMN_BAND = 0.5;
const PROFILE_ROW_BAND = 0.8;

const MIN_PROFILE_OVERLAP_ROWS = 32;

const MIN_PROFILE_DEVIATION = 2;

const MAX_WINNING_SCORE_RATIO = 0.5;
// Captures are lossless and a truly aligned band differs only by carets, hover states and
// animations, so a real winner scores close to zero; a page whose true shift lies outside the
// searched range can still produce a relative winner by aliasing onto repetitive content (a
// footer's evenly spaced link columns did exactly that, live, and reported travel in the wrong
// direction), and the absolute bar is what refuses it.
const MAX_WINNING_SCORE = 6;

// Returns undefined rather than a number the caller cannot trust: mismatched captures, a band flat
// enough that any shift matches it (a blank page), or a winner too close to the field to be a real
// alignment.
export function estimateVerticalTravel(
  before: LumaImage,
  after: LumaImage,
  options: VerticalTravelOptions = {},
): number | undefined {
  if (before.width !== after.width || before.height !== after.height) return undefined;
  const columnStart = Math.floor(before.width * ((1 - PROFILE_COLUMN_BAND) / 2));
  const columnCount = Math.max(1, Math.floor(before.width * PROFILE_COLUMN_BAND));
  const rowStart = Math.floor(before.height * ((1 - PROFILE_ROW_BAND) / 2));
  const rowCount = Math.max(1, Math.floor(before.height * PROFILE_ROW_BAND));
  if (rowCount < MIN_PROFILE_OVERLAP_ROWS) return undefined;

  const beforeProfile = rowProfile(before, rowStart, rowCount, columnStart, columnCount);
  const afterProfile = rowProfile(after, rowStart, rowCount, columnStart, columnCount);
  if (meanAbsoluteDeviation(beforeProfile) < MIN_PROFILE_DEVIATION) return undefined;

  const maxShift = Math.max(0, Math.floor(options.maxShift ?? Math.floor(rowCount * 0.9)));
  const scores: number[] = [];
  const alignments: { shift: number; score: number }[] = [];

  const minimumOverlap = Math.max(MIN_PROFILE_OVERLAP_ROWS, Math.ceil(rowCount * 0.4));
  let best: { shift: number; score: number } | undefined;
  for (let shift = -maxShift; shift <= maxShift; shift += 1) {
    const from = Math.max(0, -shift);
    const to = Math.min(rowCount, rowCount - shift);
    if (to - from < minimumOverlap) continue;
    let total = 0;
    for (let index = from; index < to; index += 1) {
      total += Math.abs(afterProfile[index]! - beforeProfile[index + shift]!);
    }
    const score = total / (to - from);
    scores.push(score);
    alignments.push({ shift, score });
    if (!best || score < best.score) best = { shift, score };
  }
  if (!best || scores.length === 0) return undefined;
  if (best.score > MAX_WINNING_SCORE) return undefined;
  const winner = best;
  // Beating the median is not enough: a false alias otherwise teaches an inflated gearing and makes
  // every subsequent scroll too short.
  if (
    alignments.some(
      (candidate) =>
        Math.abs(candidate.shift - winner.shift) > 3 && candidate.score <= winner.score + 0.5,
    )
  )
    return undefined;
  const median = scores.toSorted((first, second) => first - second)[scores.length >> 1]!;
  if (!(best.score < median * MAX_WINNING_SCORE_RATIO)) return undefined;
  return best.shift;
}

function rowProfile(
  image: LumaImage,
  rowStart: number,
  rowCount: number,
  columnStart: number,
  columnCount: number,
): Float64Array {
  const profile = new Float64Array(rowCount);
  for (let row = 0; row < rowCount; row += 1) {
    const base = (rowStart + row) * image.width + columnStart;
    let total = 0;
    for (let column = 0; column < columnCount; column += 1) total += image.luma[base + column]!;
    profile[row] = total / columnCount;
  }
  return profile;
}

function meanAbsoluteDeviation(profile: Float64Array): number {
  if (profile.length === 0) return 0;
  let total = 0;
  for (const value of profile) total += value;
  const mean = total / profile.length;
  let deviation = 0;
  for (const value of profile) deviation += Math.abs(value - mean);
  return deviation / profile.length;
}

const MAX_GEARING_KEYS = 64;

export const MIN_SCROLL_GEARING = 0.05;
export const MAX_SCROLL_GEARING = 50;

export const MIN_LEARNABLE_SCROLL_INJECTION = 30;

export const SCROLL_GEARING_SMOOTHING = 0.5;

export class ScrollGearingStore {
  private readonly gearings = new Map<string, number>();

  gearing(key: string | undefined): number {
    return (key === undefined ? undefined : this.gearings.get(key)) ?? 1;
  }

  has(key: string | undefined): boolean {
    return key !== undefined && this.gearings.has(key);
  }

  plan(key: string | undefined, requested: number, fallback?: number): number {
    if (!Number.isFinite(requested) || requested === 0) return 0;
    const scaled =
      requested / ((key === undefined ? undefined : this.gearings.get(key)) ?? fallback ?? 1);
    if (Math.abs(scaled) < 1) return Math.sign(scaled);
    return scaled;
  }

  // Folds one observation in. `injected` is the delta that was actually sent — the post-`plan` value,
  // not the agent's request — because the client's gearing is what it did with what it received.
  // Samples that cannot mean anything are dropped rather than smoothed in: no travel at all (the page
  // hit its edge), travel opposing the injection (the correlator locked onto the wrong feature), an
  // injection too small to measure, and a ratio no toolkit produces. Returns whether the sample was
  // accepted, so a caller keeping a durable per-app fallback writes only real observations.
  learn(key: string | undefined, injected: number, traveled: number): boolean {
    if (key === undefined) return false;
    if (!Number.isFinite(injected) || !Number.isFinite(traveled)) return false;
    if (traveled === 0 || Math.abs(injected) < MIN_LEARNABLE_SCROLL_INJECTION) return false;
    if (Math.sign(traveled) !== Math.sign(injected)) return false;
    const observed = traveled / injected;
    if (observed < MIN_SCROLL_GEARING || observed > MAX_SCROLL_GEARING) return false;
    const previous = this.gearings.get(key);
    const next =
      previous === undefined
        ? observed
        : previous * (1 - SCROLL_GEARING_SMOOTHING) + observed * SCROLL_GEARING_SMOOTHING;
    if (previous === undefined && this.gearings.size >= MAX_GEARING_KEYS) {
      const oldest = this.gearings.keys().next();
      if (!oldest.done) this.gearings.delete(oldest.value);
    }
    this.gearings.set(key, Math.min(MAX_SCROLL_GEARING, Math.max(MIN_SCROLL_GEARING, next)));
    return true;
  }
}
