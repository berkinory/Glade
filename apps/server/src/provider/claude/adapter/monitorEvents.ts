import { Effect, FileSystem } from "effect";
import type { EventId } from "@glade/contracts/core/baseSchemas";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { findClaudeSessionTranscriptPath } from "../claudeSessionTranscript.ts";
import { readAppendedLines } from "../claudeWorkflowRuntime.ts";
import { asCanonicalTurnId, nativeProviderRefs } from "./messageContent";
import { type ClaudeSessionContext, PROVIDER } from "./sessionTypes";

// Claude's Monitor tool wakes the agent with a `<task-notification>` user turn per batch of output.
// The SDK stream never forwards that turn (checked against CLI 2.1.296, also with
// --replay-user-messages): only the reply and a result stamped `origin: task-notification` arrive.
// The CLI does persist the notification in the session transcript, so it is read back from there.

// The notification that starts a turn sits at the transcript tail, so a read never reaches further.
const TRANSCRIPT_TAIL_BYTES = 512 * 1024;
const MAX_MONITOR_TEXT_CHARS = 2_000;

type ClaudeMonitorOutcome = "updated" | "completed" | "failed" | "stopped";

interface ClaudeMonitorEvent {
  readonly id: string;
  readonly createdAt: string;
  readonly taskId: string;
  readonly name: string;
  readonly output: string;
  readonly outcome: ClaudeMonitorOutcome;
}

export interface ClaudeMonitorEventCursor {
  sessionId: string | undefined;
  path: string | undefined;
  offset: number | undefined;
  readonly seenIds: Set<string>;
}

export function makeClaudeMonitorEventCursor(): ClaudeMonitorEventCursor {
  return { sessionId: undefined, path: undefined, offset: undefined, seenIds: new Set() };
}

function truncate(text: string): string {
  return text.length > MAX_MONITOR_TEXT_CHARS
    ? `${text.slice(0, MAX_MONITOR_TEXT_CHARS - 1)}…`
    : text;
}

function tagText(body: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)?.[1];
}

// Only Monitor notifications carry `<event>` lines. Finished background commands and agents already
// arrive as SDK task_notification messages.
function parseMonitorNotification(
  text: string,
): Omit<ClaudeMonitorEvent, "id" | "createdAt"> | undefined {
  const body = tagText(text, "task-notification");
  const taskId = body ? tagText(body, "task-id")?.trim() : undefined;
  const event = body ? tagText(body, "event")?.trim() : undefined;
  if (!body || !taskId || !event) return undefined;
  // `Monitor event: "<name>"` per batch, `Monitor "<name>" stream ended` at the end.
  const name = (tagText(body, "summary") ?? "")
    .trim()
    .replace(/^Monitor event:\s*/i, "")
    .replace(/^Monitor\s+/i, "")
    .replace(/"([^"]*)"/, "$1")
    .replace(/\s+stream ended$/i, "");
  const status = tagText(body, "status")?.trim();
  const outcome: ClaudeMonitorOutcome =
    status === "completed" || status === "failed" || status === "stopped"
      ? status
      : status === "cancelled"
        ? "stopped"
        : "updated";
  return { taskId, name: truncate(name), output: truncate(event), outcome };
}

function notificationText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((block: { type?: unknown; text?: unknown } | null) =>
      block?.type === "text" && typeof block.text === "string" ? block.text : undefined,
    )
    .filter((value) => value !== undefined)
    .join("\n");
  return text.length > 0 ? text : undefined;
}

function monitorEventFromLine(line: string, notBeforeMs: number): ClaudeMonitorEvent | undefined {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    // A tail read can start mid-line; that fragment is skipped.
    return undefined;
  }
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  const origin = record.origin as { kind?: unknown } | undefined;
  if (
    record.type !== "user" ||
    record.isSidechain === true ||
    origin?.kind !== "task-notification" ||
    typeof record.uuid !== "string" ||
    typeof record.timestamp !== "string"
  ) {
    return undefined;
  }
  const createdAtMs = Date.parse(record.timestamp);
  // Notifications from before this live session belong to turns that were already shown.
  if (!Number.isFinite(createdAtMs) || createdAtMs < notBeforeMs) return undefined;
  const text = notificationText((record.message as { content?: unknown } | undefined)?.content);
  const parsed = text ? parseMonitorNotification(text) : undefined;
  return parsed
    ? { id: record.uuid, createdAt: new Date(createdAtMs).toISOString(), ...parsed }
    : undefined;
}

// Returns Monitor events persisted since the previous read, oldest first. The rows are display-only,
// so read failures are deliberately cosmetic: a missing or unreadable transcript shows no Monitor
// event and never fails the turn.
const readClaudeMonitorEvents = (
  fileSystem: FileSystem.FileSystem,
  cursor: ClaudeMonitorEventCursor,
  input: {
    readonly sessionId: string;
    readonly configDir: string | undefined;
    readonly notBefore: string;
  },
): Effect.Effect<ReadonlyArray<ClaudeMonitorEvent>> =>
  Effect.gen(function* () {
    if (cursor.sessionId !== input.sessionId) {
      cursor.sessionId = input.sessionId;
      cursor.path = undefined;
      cursor.offset = undefined;
    }
    cursor.path ??= yield* Effect.tryPromise(() =>
      findClaudeSessionTranscriptPath({
        sessionId: input.sessionId,
        ...(input.configDir ? { configDir: input.configDir } : {}),
      }),
    );
    if (!cursor.path) return [];
    const size = Number((yield* fileSystem.stat(cursor.path)).size);
    if (
      cursor.offset === undefined ||
      cursor.offset > size ||
      size - cursor.offset > TRANSCRIPT_TAIL_BYTES
    ) {
      cursor.offset = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
    }
    const appended = yield* readAppendedLines(
      fileSystem,
      cursor.path,
      cursor.offset,
      Number.POSITIVE_INFINITY,
    );
    if (!appended) return [];
    cursor.offset = appended.nextOffset;
    const notBeforeMs = Date.parse(input.notBefore);
    const events: Array<ClaudeMonitorEvent> = [];
    for (const line of appended.lines) {
      const event = monitorEventFromLine(line, Number.isFinite(notBeforeMs) ? notBeforeMs : 0);
      if (!event || cursor.seenIds.has(event.id)) continue;
      cursor.seenIds.add(event.id);
      events.push(event);
    }
    return events;
  }).pipe(Effect.orElseSucceed((): ReadonlyArray<ClaudeMonitorEvent> => []));

export function makeClaudeMonitorEvents(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  readonly offerRuntimeEvent: ClaudeRuntimeEventsShape["offerRuntimeEvent"];
}) {
  const { fileSystem, makeEventStamp, offerRuntimeEvent } = input;

  // Emits the Monitor events that woke the agent into the current turn. Runs inline before the
  // turn's reply is handled, so the rows never land inside the reply they prompted.
  const emitMonitorEvents = (context: ClaudeSessionContext): Effect.Effect<void> =>
    Effect.gen(function* () {
      const cursor = context.monitorEventCursor;
      const sessionId = context.resumeSessionId;
      if (!cursor || !context.turnState || !sessionId) return;
      const turnId = asCanonicalTurnId(context.turnState.turnId);
      const events = yield* readClaudeMonitorEvents(fileSystem, cursor, {
        sessionId,
        configDir: context.claudeConfigDir,
        notBefore: context.startedAt,
      });
      for (const event of events) {
        if (context.stopped) return;
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent(context, {
          type: "runtime.warning",
          eventId: stamp.eventId,
          provider: PROVIDER,
          // The notification time places the row above the reply it prompted.
          createdAt: event.createdAt,
          threadId: context.session.threadId,
          turnId,
          payload: {
            message: event.name ? `${event.name}: ${event.output}` : event.output,
            detail: {
              type: "system",
              subtype: "monitor_event",
              task_id: event.taskId,
              name: event.name,
              output: event.output,
              outcome: event.outcome,
            },
          },
          providerRefs: nativeProviderRefs(context),
        });
      }
    });

  return { emitMonitorEvents };
}
