import type { ChatMessage } from "./types";
import type { TimelineEntry, WorkLogEntry } from "./workLog.types";
import { compareTimelineEntries } from "./workLog.ordering";

type TimelineComparator = (left: TimelineEntry, right: TimelineEntry) => number;

function areTimelineEntriesOrdered(
  entries: ReadonlyArray<TimelineEntry>,
  compare: TimelineComparator,
): boolean {
  for (let index = 1; index < entries.length; index += 1) {
    if (compare(entries[index - 1]!, entries[index]!) > 0) {
      return false;
    }
  }
  return true;
}

function sortedTimelineEntries(
  entries: TimelineEntry[],
  compare: TimelineComparator,
): TimelineEntry[] {
  return areTimelineEntriesOrdered(entries, compare) ? entries : entries.toSorted(compare);
}

function mergeTimelineEntries(
  left: ReadonlyArray<TimelineEntry>,
  right: ReadonlyArray<TimelineEntry>,
  compare: TimelineComparator,
): TimelineEntry[] {
  if (left.length === 0) {
    return [...right];
  }
  if (right.length === 0) {
    return [...left];
  }

  const merged: TimelineEntry[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftEntry = left[leftIndex]!;
    const rightEntry = right[rightIndex]!;
    if (compare(leftEntry, rightEntry) <= 0) {
      merged.push(leftEntry);
      leftIndex += 1;
    } else {
      merged.push(rightEntry);
      rightIndex += 1;
    }
  }
  while (leftIndex < left.length) {
    merged.push(left[leftIndex]!);
    leftIndex += 1;
  }
  while (rightIndex < right.length) {
    merged.push(right[rightIndex]!);
    rightIndex += 1;
  }
  return merged;
}

const coalescedMessageCache = new WeakMap<
  ChatMessage,
  { readonly signature: string; readonly displayMessage: ChatMessage }
>();

function coalesceAdjacentMessageSegments(entries: TimelineEntry[]): TimelineEntry[] {
  if (
    !entries.some((entry, index) => {
      const previous = entries[index - 1];
      return (
        entry.kind === "message-segment" &&
        previous?.kind === "message-segment" &&
        entry.message === previous.message &&
        entry.segmentIndex === previous.segmentIndex + 1
      );
    })
  ) {
    return entries;
  }
  type SegmentEntry = Extract<TimelineEntry, { kind: "message-segment" }>;
  const groupsByMessage = new Map<ChatMessage, SegmentEntry[][]>();
  const runs: Array<TimelineEntry | SegmentEntry[]> = [];
  for (const entry of entries) {
    const previous = runs.at(-1);
    if (entry.kind !== "message-segment") {
      runs.push(entry);
    } else if (
      Array.isArray(previous) &&
      previous[0]!.message === entry.message &&
      previous.at(-1)!.segmentIndex + 1 === entry.segmentIndex
    ) {
      previous.push(entry);
    } else {
      const group = [entry];
      runs.push(group);
      const groups = groupsByMessage.get(entry.message) ?? [];
      groups.push(group);
      groupsByMessage.set(entry.message, groups);
    }
  }

  const replacements = new Map<SegmentEntry[], TimelineEntry>();
  for (const [message, groups] of groupsByMessage) {
    if (!groups.some((group) => group.length > 1)) continue;
    const signature = groups
      .map((group) => `${group[0]!.segmentIndex}:${group.at(-1)!.segmentIndex}`)
      .join(",");
    const cached = coalescedMessageCache.get(message);
    let displayMessage = cached?.signature === signature ? cached.displayMessage : undefined;
    if (displayMessage === undefined) {
      const textSegments = groups.map((group) => {
        const first = message.textSegments![group[0]!.segmentIndex]!;
        const last = message.textSegments![group.at(-1)!.segmentIndex]!;
        return {
          ...first,
          endedAt: last.endedAt,
          text: group.map((entry) => message.textSegments![entry.segmentIndex]!.text).join(""),
        };
      });
      displayMessage =
        groups.length === 1 && textSegments[0]!.text === message.text
          ? message
          : { ...message, textSegments };
      coalescedMessageCache.set(message, { signature, displayMessage });
    }
    if (displayMessage === message) {
      replacements.set(groups[0]!, {
        id: message.id,
        kind: "message",
        createdAt: groups[0]![0]!.createdAt,
        message,
      });
      continue;
    }
    const coalescedMessage = displayMessage;
    groups.forEach((group, segmentIndex) => {
      replacements.set(group, { ...group[0]!, message: coalescedMessage, segmentIndex });
    });
  }
  return runs.map((run) => (Array.isArray(run) ? (replacements.get(run) ?? run[0]!) : run));
}

export function deriveTimelineEntries(
  messages: ChatMessage[],
  workEntries: WorkLogEntry[],
): TimelineEntry[] {
  // Native import order comes from the archive, including sources with equal or regressing clocks.
  const importedRows: TimelineEntry[] = messages
    .filter((message) => message.id.startsWith("import:") && message.source === "native")
    .map((message) => ({ id: message.id, kind: "message", createdAt: message.createdAt, message }));
  messages = messages.filter(
    (message) => !message.id.startsWith("import:") || message.source !== "native",
  );
  const messageRows: TimelineEntry[] = messages.flatMap((message): TimelineEntry[] => {
    const displayMessage = message;

    const textSegments = displayMessage.textSegments;
    if (
      displayMessage.role === "assistant" &&
      !displayMessage.streaming &&
      textSegments !== undefined &&
      textSegments.length > 1
    ) {
      return textSegments.map((segment, segmentIndex) => ({
        id: `${displayMessage.id}#seg:${segmentIndex}`,
        kind: "message-segment" as const,
        createdAt: segment.startedAt,
        sequence: segment.sequence,
        message: displayMessage,
        segmentIndex,
      }));
    }
    return [
      {
        id: displayMessage.id,
        kind: "message",
        createdAt: displayMessage.createdAt,
        message: displayMessage,
      },
    ];
  });

  const workRows: TimelineEntry[] = workEntries.map((entry) => ({
    id: entry.id,
    kind: "work",
    createdAt: entry.createdAt,
    ...(entry.sequence !== undefined ? { sequence: entry.sequence } : {}),
    entry,
  }));

  // Late tool completion/replay timestamps must not move an earlier turn's work below a new user
  // request and inflate that request's tool disclosure.
  const userStarts: string[] = [];
  const messageOrder = new Map<string, number>();
  const turnOrder = new Map<string, number>();
  const messagesOrdered = messages.every(
    (message, index) =>
      index === 0 || messages[index - 1]!.createdAt.localeCompare(message.createdAt) <= 0,
  );
  const orderedMessages = messagesOrdered
    ? messages
    : messages.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const message of orderedMessages) {
    const startsNewTurn =
      message.startsNewTurn ??
      (message.dispatchMode !== "steer" ||
        (message.turnId !== null && message.turnId !== undefined));
    if (message.role === "user" && startsNewTurn) {
      userStarts.push(message.createdAt);
    }
    const order = userStarts.length;
    messageOrder.set(message.id, order);
    if (message.turnId && !turnOrder.has(message.turnId)) turnOrder.set(message.turnId, order);
  }

  const chronologicalOrder = (createdAt: string): number => {
    let low = 0;
    let high = userStarts.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (userStarts[mid]!.localeCompare(createdAt) <= 0) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const orderByEntry = new Map<TimelineEntry, number>();
  for (const entry of [...messageRows, ...workRows]) {
    if (entry.kind === "message" || entry.kind === "message-segment") {
      orderByEntry.set(
        entry,
        messageOrder.get(entry.message.id) ?? chronologicalOrder(entry.createdAt),
      );
      continue;
    }

    const turnId = entry.entry.turnId ?? undefined;
    const turnBlock = turnId === undefined ? undefined : turnOrder.get(turnId);
    const chronological = chronologicalOrder(entry.createdAt);
    orderByEntry.set(
      entry,
      turnBlock === undefined ? chronological : Math.min(turnBlock, chronological),
    );
  }
  const compare: TimelineComparator = (left, right) =>
    orderByEntry.get(left)! - orderByEntry.get(right)! || compareTimelineEntries(left, right);

  return [
    ...importedRows,
    ...coalesceAdjacentMessageSegments(
      mergeTimelineEntries(
        sortedTimelineEntries(messageRows, compare),
        sortedTimelineEntries(workRows, compare),
        compare,
      ),
    ),
  ];
}
