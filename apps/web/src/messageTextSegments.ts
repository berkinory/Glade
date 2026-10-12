import type { OrchestrationMessageTextSegment } from "@glade/contracts/orchestration/threadEntities";

export function textSegmentsCoverText(
  segments: ReadonlyArray<OrchestrationMessageTextSegment>,
  text: string,
): boolean {
  return segments.map((segment) => segment.text).join("") === text;
}

// Segments only arrive with snapshots while later deltas keep extending the text, and a settled
// multi-segment reply renders from its segments alone. These rules mirror the server's segment
// projection so the tail of a reply never stays hidden until the next snapshot. A message the client
// has no segments for keeps none.
export function advanceMessageTextSegments(
  previous: ReadonlyArray<OrchestrationMessageTextSegment> | undefined,
  input: {
    readonly streaming: boolean;
    readonly deltaText: string;
    readonly nextText: string;
    readonly segmentStartedAt: string | undefined;
    readonly segmentSequence: number;
    readonly updatedAt: string;
  },
): OrchestrationMessageTextSegment[] | undefined {
  if (previous === undefined || previous.length === 0) {
    return undefined;
  }
  if (!input.streaming) {
    if (previous.length < 2 || !textSegmentsCoverText(previous, input.nextText)) {
      return undefined;
    }
    const tail = previous.at(-1)!;
    return [...previous.slice(0, -1), { ...tail, endedAt: input.updatedAt }];
  }
  if (input.segmentStartedAt !== undefined) {
    const opened: OrchestrationMessageTextSegment = {
      sequence: input.segmentSequence,
      startedAt: input.segmentStartedAt,
      endedAt: input.updatedAt,
      text: input.deltaText,
    };
    // A repeated boundary restarts that segment, as the server's projection does.
    const restartedIndex = previous.findIndex(
      (segment) => segment.sequence === input.segmentSequence,
    );
    return restartedIndex >= 0 ? previous.with(restartedIndex, opened) : [...previous, opened];
  }
  const tail = previous.at(-1)!;
  return [
    ...previous.slice(0, -1),
    { ...tail, text: `${tail.text}${input.deltaText}`, endedAt: input.updatedAt },
  ];
}
