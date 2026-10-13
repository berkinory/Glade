import { RuntimeItemId } from "@glade/contracts/core/baseSchemas";
import type {
  CanonicalItemType,
  RuntimeContentStreamKind,
  RuntimeItemStatus,
} from "@glade/contracts/provider/runtimeMetadata";

import type { RuntimeEventDraft } from "../core/runtimeEventDraft.ts";
import type { MspItem } from "./mspProtocol.ts";
import { museToolPresentation } from "./museToolPresentation.ts";

type ItemPhase = "started" | "updated" | "completed";

const TOOL_KINDS = new Set(["toolCall", "webSearch", "subagent"]);

interface TrackedItem {
  readonly itemType: CanonicalItemType;
  // Text already streamed per field path, so a terminal item only adds what deltas missed.
  readonly streamed: Map<string, string>;
  output: string;
  title: string | undefined;
  data: Record<string, unknown> | undefined;
  completed: boolean;
}

export interface MuseTurnProjection {
  readonly item: (phase: ItemPhase, item: MspItem) => ReadonlyArray<RuntimeEventDraft>;
  readonly delta: (
    itemId: string,
    field: string | undefined,
    delta: string,
  ) => ReadonlyArray<RuntimeEventDraft>;
  // Closes items still open when the turn ends, so the transcript never shows a running row.
  readonly finish: (failed: boolean) => ReadonlyArray<RuntimeEventDraft>;
}

function canonicalItemType(item: MspItem): CanonicalItemType | undefined {
  if (item.kind === "agentMessage") return "assistant_message";
  if (item.kind === "reasoning") return "reasoning";
  if (item.kind === "compaction") return "context_compaction";
  // User messages are Glade's own; reminders, hooks, workflows and side chats are Muse features
  // outside Glade's scope.
  return TOOL_KINDS.has(item.kind) ? museToolPresentation(item, "").itemType : undefined;
}

function itemStatus(status: string): RuntimeItemStatus {
  switch (status) {
    case "inProgress":
      return "inProgress";
    case "completed":
      return "completed";
    case "rejected":
      return "declined";
    default:
      return "failed";
  }
}

// Streamed text lives at field paths: `text` for replies, `summary.N` for reasoning summaries and
// `output` for tool output.
function streamFor(
  itemType: CanonicalItemType,
  field: string,
): { kind: RuntimeContentStreamKind; summaryIndex?: number } | undefined {
  if (itemType === "assistant_message")
    return field === "text" ? { kind: "assistant_text" } : undefined;
  if (itemType === "reasoning") {
    const summary = /^summary\.(\d+)$/u.exec(field);
    if (summary) return { kind: "reasoning_summary_text", summaryIndex: Number(summary[1]) };
    return field === "text" ? { kind: "reasoning_text" } : undefined;
  }
  if (itemType === "command_execution" && field === "output") return { kind: "command_output" };
  return undefined;
}

export function makeMuseTurnProjection(): MuseTurnProjection {
  const items = new Map<string, TrackedItem>();

  const textDelta = (
    itemId: string,
    tracked: TrackedItem,
    field: string,
    delta: string,
  ): RuntimeEventDraft[] => {
    if (field === "output") tracked.output += delta;
    tracked.streamed.set(field, (tracked.streamed.get(field) ?? "") + delta);
    const stream = streamFor(tracked.itemType, field);
    if (!stream || delta.length === 0) return [];
    return [
      {
        type: "content.delta",
        itemId: RuntimeItemId.makeUnsafe(itemId),
        payload: {
          streamKind: stream.kind,
          delta,
          ...(stream.summaryIndex !== undefined ? { summaryIndex: stream.summaryIndex } : {}),
        },
      },
    ];
  };

  // The full text a terminal or re-emitted item carries, per field path.
  const fieldTexts = (item: MspItem): ReadonlyArray<readonly [string, string]> => [
    ...(item.text !== undefined ? [["text", item.text] as const] : []),
    ...(item.summary ?? []).map((text, index) => [`summary.${index}`, text] as const),
    ...(item.visibleOutput !== undefined ? [["output", item.visibleOutput] as const] : []),
  ];

  const catchUp = (tracked: TrackedItem, item: MspItem): RuntimeEventDraft[] =>
    fieldTexts(item).flatMap(([field, text]) => {
      const streamed = tracked.streamed.get(field) ?? "";
      return text.length > streamed.length && text.startsWith(streamed)
        ? textDelta(item.itemId, tracked, field, text.slice(streamed.length))
        : [];
    });

  const lifecycle = (
    type: "item.started" | "item.updated" | "item.completed",
    itemId: string,
    tracked: TrackedItem,
    status: RuntimeItemStatus,
  ): RuntimeEventDraft => ({
    type,
    itemId: RuntimeItemId.makeUnsafe(itemId),
    payload: {
      itemType: tracked.itemType,
      status,
      ...(tracked.title ? { title: tracked.title } : {}),
      ...(tracked.data ? { data: tracked.data } : {}),
    },
  });

  return {
    item: (phase, item) => {
      let tracked = items.get(item.itemId);
      const drafts: RuntimeEventDraft[] = [];
      if (!tracked) {
        const itemType = canonicalItemType(item);
        if (!itemType) return [];
        tracked = {
          itemType,
          streamed: new Map(),
          output: "",
          title: itemType === "reasoning" ? "Thinking" : undefined,
          data: undefined,
          completed: false,
        };
        items.set(item.itemId, tracked);
        if (TOOL_KINDS.has(item.kind)) {
          const presentation = museToolPresentation(item, item.visibleOutput ?? "");
          tracked.title = presentation.title;
          tracked.data = presentation.data;
        }
        drafts.push(lifecycle("item.started", item.itemId, tracked, "inProgress"));
      }
      if (tracked.completed) return drafts;
      drafts.push(...catchUp(tracked, item));
      if (TOOL_KINDS.has(item.kind)) {
        const presentation = museToolPresentation(item, item.visibleOutput ?? tracked.output);
        tracked.title = presentation.title;
        tracked.data = presentation.data;
      }
      if (phase === "completed") {
        tracked.completed = true;
        drafts.push(lifecycle("item.completed", item.itemId, tracked, itemStatus(item.status)));
      } else if (phase === "updated") {
        drafts.push(lifecycle("item.updated", item.itemId, tracked, "inProgress"));
      }
      return drafts;
    },
    delta: (itemId, field, delta) => {
      const tracked = items.get(itemId);
      return tracked && !tracked.completed
        ? textDelta(itemId, tracked, field ?? "text", delta)
        : [];
    },
    finish: (failed) => {
      const drafts: RuntimeEventDraft[] = [];
      for (const [itemId, tracked] of items) {
        if (tracked.completed) continue;
        tracked.completed = true;
        drafts.push(lifecycle("item.completed", itemId, tracked, failed ? "failed" : "completed"));
      }
      return drafts;
    },
  };
}
