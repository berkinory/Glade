export const VISUAL_REPLY_COLUMN_WIDTH = 728;
export const VISUAL_REPLY_MEASURE_WIDTHS = [320, 375, 430, 520, 640, 728, 860, 1000, 1144];

interface VisualReplyLayout {
  readonly height?: number | undefined;
  readonly heights?: readonly (readonly [number, number])[] | undefined;
}

function measuredHeight(heights: readonly (readonly [number, number])[], width: number): number {
  const index = heights.findIndex(([measuredWidth]) => measuredWidth >= width);
  const high = index === -1 ? heights.length - 1 : index;
  const low = heights[high]![0] === width ? high : Math.max(0, high - 1);
  return Math.max(heights[low]![1], heights[high]![1]);
}

export function visualReplyFrameHeight(
  reply: VisualReplyLayout,
  width: number,
  contentHeight?: number,
): number {
  const clamp = (height: number) => Math.min(2000, Math.max(80, Math.round(height)));
  // Previously published replies have no requested height or server measurements.
  if (reply.height === undefined) return clamp(contentHeight ?? 420);
  if (!reply.heights?.length) return clamp(Math.min(reply.height, contentHeight ?? reply.height));
  const cap =
    measuredHeight(reply.heights, VISUAL_REPLY_COLUMN_WIDTH) > reply.height ? reply.height : 2000;
  return clamp(Math.min(cap, contentHeight ?? measuredHeight(reply.heights, width)));
}
