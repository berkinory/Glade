import { type MessageId } from "@glade/contracts/core/baseSchemas";
import type { TimelineEntry } from "../../workLog.types";

export interface MessageTrailItem {
  id: MessageId;

  ordinal: number;

  preview: string;

  responsePreview: string;

  attachmentCount: number;
}

const MAX_PREVIEW_LENGTH = 280;

function normalizePreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_PREVIEW_LENGTH
    ? `${collapsed.slice(0, MAX_PREVIEW_LENGTH).trimEnd()}…`
    : collapsed;
}

const previewByMessage = new WeakMap<object, string>();

function normalizePreviewCached(message: { readonly text: string }): string {
  const cached = previewByMessage.get(message);
  if (cached !== undefined) {
    return cached;
  }
  const preview = normalizePreview(message.text);
  previewByMessage.set(message, preview);
  return preview;
}

const trailItemsByEntries = new WeakMap<readonly TimelineEntry[], MessageTrailItem[]>();

export function deriveMessageTrailItems(
  timelineEntries: readonly TimelineEntry[],
): MessageTrailItem[] {
  const cachedItems = trailItemsByEntries.get(timelineEntries);
  if (cachedItems !== undefined) {
    return cachedItems;
  }
  const items: MessageTrailItem[] = [];

  let currentTurnIndex = -1;
  for (const entry of timelineEntries) {
    if (entry.kind !== "message") {
      continue;
    }
    const { role } = entry.message;
    if (role === "user") {
      items.push({
        id: entry.message.id,
        ordinal: items.length + 1,
        preview: normalizePreviewCached(entry.message),
        responsePreview: "",
        attachmentCount: entry.message.attachments?.length ?? 0,
      });
      currentTurnIndex = items.length - 1;
    } else if (role === "assistant" && currentTurnIndex >= 0) {
      const responsePreview = normalizePreviewCached(entry.message);
      if (responsePreview !== "") {
        items[currentTurnIndex]!.responsePreview = responsePreview;
      }
    }
  }
  trailItemsByEntries.set(timelineEntries, items);
  return items;
}

export interface MessageTrailAnchor {
  id: MessageId;
  rowIndex: number;
}

function resolveActiveTrailMessageId(
  anchors: readonly MessageTrailAnchor[],
  topVisibleRowIndex: number,
): MessageId | null {
  if (anchors.length === 0) {
    return null;
  }

  let activeId: MessageId = anchors[0]!.id;
  for (const anchor of anchors) {
    if (anchor.rowIndex <= topVisibleRowIndex) {
      activeId = anchor.id;
    } else {
      break;
    }
  }
  return activeId;
}

export interface ActiveTrailSnapshot {
  currentId: MessageId | null;
  visibleIds: readonly MessageId[];
}

const EMPTY_ACTIVE_TRAIL_SNAPSHOT: ActiveTrailSnapshot = {
  currentId: null,
  visibleIds: [],
};

function areMessageIdListsEqual(a: readonly MessageId[], b: readonly MessageId[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function areActiveTrailSnapshotsEqual(a: ActiveTrailSnapshot, b: ActiveTrailSnapshot): boolean {
  return a.currentId === b.currentId && areMessageIdListsEqual(a.visibleIds, b.visibleIds);
}

export function resolveActiveTrailSnapshot(
  anchors: readonly MessageTrailAnchor[],
  topVisibleRowIndex: number,
  bottomVisibleRowIndex: number,
): ActiveTrailSnapshot {
  if (anchors.length === 0 || !Number.isFinite(topVisibleRowIndex)) {
    return EMPTY_ACTIVE_TRAIL_SNAPSHOT;
  }
  const currentId = resolveActiveTrailMessageId(anchors, topVisibleRowIndex);
  const bottomRowIndex = Number.isFinite(bottomVisibleRowIndex)
    ? Math.max(topVisibleRowIndex, bottomVisibleRowIndex)
    : topVisibleRowIndex;
  const visibleIds: MessageId[] = [];
  for (const anchor of anchors) {
    if (anchor.rowIndex < topVisibleRowIndex) {
      continue;
    }
    if (anchor.rowIndex > bottomRowIndex) {
      break;
    }
    visibleIds.push(anchor.id);
  }
  return visibleIds.length === 0 && currentId === null
    ? EMPTY_ACTIVE_TRAIL_SNAPSHOT
    : { currentId, visibleIds };
}

export interface ActiveTrailStore {
  get: () => ActiveTrailSnapshot;
  set: (value: ActiveTrailSnapshot | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createActiveTrailStore(): ActiveTrailStore {
  let current: ActiveTrailSnapshot = EMPTY_ACTIVE_TRAIL_SNAPSHOT;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (value) => {
      const next = value ?? EMPTY_ACTIVE_TRAIL_SNAPSHOT;
      if (areActiveTrailSnapshotsEqual(next, current)) {
        return;
      }
      current = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (max < min) {
    return min;
  }
  return value < min ? min : value > max ? max : value;
}

export interface TrailGeometry {
  startY: number;

  spacing: number;

  centerYs: number[];

  contentHeight: number;
}

export function computeTrailGeometry(input: {
  count: number;
  spacingPx?: number;
  paddingPx?: number;
}): TrailGeometry | null {
  const count = input.count;
  const spacing = count <= 1 ? 0 : (input.spacingPx ?? 10);
  const padding = input.paddingPx ?? 12;
  if (count <= 0) {
    return null;
  }
  const centerYs: number[] = [];
  for (let i = 0; i < count; i += 1) {
    centerYs.push(padding + i * spacing);
  }
  return {
    startY: padding,
    spacing,
    centerYs,
    contentHeight: 2 * padding + (count - 1) * spacing,
  };
}

export function computeSigma(spacing: number): number {
  return clampNumber(spacing * 1.5, Math.min(spacing * 2, 8), 22);
}

export function computeGaussianWeights(
  centerYs: readonly number[],
  pointerY: number,
  sigma: number,
): number[] {
  if (sigma <= 0) {
    return centerYs.map((centerY) => (centerY === pointerY ? 1 : 0));
  }
  const twoSigmaSquared = 2 * sigma * sigma;
  return centerYs.map((centerY) => {
    const distance = centerY - pointerY;
    return Math.exp(-(distance * distance) / twoSigmaSquared);
  });
}

export interface TickStyle {
  width: number;
  opacity: number;
}

export function computeTickStyles(
  weights: readonly number[],
  currentAnchorIndex: number | null,
  baseW: number,
  effectiveMaxW: number,
  restOpacity: number,
  anchorOpacity: number,
): TickStyle[] {
  return weights.map((weight, index) => ({
    width: baseW + (effectiveMaxW - baseW) * weight,
    opacity: index === currentAnchorIndex ? anchorOpacity : restOpacity,
  }));
}

export function computeRestStyles(
  count: number,
  currentAnchorIndex: number | null,
  baseW: number,
  restOpacity: number,
  anchorOpacity: number,
): TickStyle[] {
  const styles: TickStyle[] = [];
  for (let i = 0; i < count; i += 1) {
    styles.push({ width: baseW, opacity: i === currentAnchorIndex ? anchorOpacity : restOpacity });
  }
  return styles;
}

export function computeFocusedIndex(pointerY: number, geometry: TrailGeometry): number {
  const count = geometry.centerYs.length;
  if (count <= 1 || geometry.spacing === 0) {
    return 0;
  }
  if (!Number.isFinite(pointerY)) {
    return 0;
  }
  const endY = geometry.startY + (count - 1) * geometry.spacing;
  const clampedY = clampNumber(pointerY, geometry.startY, endY);
  const raw = Math.round((clampedY - geometry.startY) / geometry.spacing);
  return clampNumber(raw, 0, count - 1);
}

export function clampTooltipTop(
  centerY: number,
  tooltipH: number,
  railH: number,
  margin = 4,
): number {
  const half = tooltipH / 2 + margin;
  return clampNumber(centerY, half, Math.max(half, railH - half));
}
