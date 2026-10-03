import { EventId, ProjectId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { type OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import { type OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";

import { getThreadsFromState } from "./threadDerivation";
import type { AppState } from "./storeState";
import { DEFAULT_RUNTIME_MODE, type Thread } from "./types";
import { vi, type Mock } from "vitest";

export function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,

    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],

    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    latestTurn: null,
    latestUserMessageAt: null,
    latestHumanMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,

    envMode: "local",
    branch: null,
    worktreePath: null,
    forkSourceThreadId: null,
    handoff: null,
    ...overrides,
  };
}

export function makeDomainEvent<TType extends OrchestrationEvent["type"]>(
  type: TType,
  payload: Extract<OrchestrationEvent, { type: TType }>["payload"],
  overrides: Partial<Omit<Extract<OrchestrationEvent, { type: TType }>, "type" | "payload">> = {},
): Extract<OrchestrationEvent, { type: TType }> {
  const aggregateId =
    "threadId" in payload
      ? payload.threadId
      : "spaceId" in payload
        ? payload.spaceId
        : "projectId" in payload
          ? payload.projectId
          : ProjectId.makeUnsafe("project-1");
  const aggregateKind =
    "threadId" in payload ? "thread" : "spaceId" in payload ? "space" : "project";
  return {
    type,
    payload,
    sequence: overrides.sequence ?? 1,
    eventId: overrides.eventId ?? EventId.makeUnsafe(`event-${crypto.randomUUID()}`),
    aggregateKind: overrides.aggregateKind ?? aggregateKind,
    aggregateId,
    occurredAt: overrides.occurredAt ?? "2026-02-27T00:00:00.000Z",
    commandId: overrides.commandId ?? null,
    causationEventId: overrides.causationEventId ?? null,
    correlationId: overrides.correlationId ?? null,
    metadata: overrides.metadata ?? {},
    ...overrides,
  } as Extract<OrchestrationEvent, { type: TType }>;
}

export function makeActivity(overrides: {
  id?: string;
  createdAt?: string;
  kind?: string;
  summary?: string;
  tone?: OrchestrationThreadActivity["tone"];
  payload?: OrchestrationThreadActivity["payload"];
  turnId?: string;
  sequence?: number;
}): OrchestrationThreadActivity {
  return {
    id: EventId.makeUnsafe(overrides.id ?? crypto.randomUUID()),
    createdAt: overrides.createdAt ?? "2026-02-23T00:00:00.000Z",
    kind: overrides.kind ?? "tool.started",
    summary: overrides.summary ?? "Tool call",
    tone: overrides.tone ?? "tool",
    payload: overrides.payload ?? {},
    turnId: overrides.turnId ? TurnId.makeUnsafe(overrides.turnId) : null,
    ...(overrides.sequence !== undefined ? { sequence: overrides.sequence } : {}),
  };
}

export function makeState(thread: Thread): AppState {
  const {
    session,
    latestTurn,

    messages,
    activities,

    turnDiffSummaries,
    ...shell
  } = thread;
  return {
    spaces: [],
    projects: [makeProject()],
    sidebarThreadSummaryById: {},
    threadsHydrated: true,
    threadIds: [thread.id],
    threadShellById: { [thread.id]: shell },
    threadSessionById: { [thread.id]: session },
    threadTurnStateById: { [thread.id]: { latestTurn } },
    messageIdsByThreadId: { [thread.id]: messages.map((message) => message.id) },
    messageByThreadId: {
      [thread.id]: Object.fromEntries(messages.map((message) => [message.id, message])),
    },
    activityIdsByThreadId: { [thread.id]: activities.map((activity) => activity.id) },
    activityByThreadId: {
      [thread.id]: Object.fromEntries(activities.map((activity) => [activity.id, activity])),
    },

    turnDiffIdsByThreadId: { [thread.id]: turnDiffSummaries.map((summary) => summary.turnId) },
    turnDiffSummaryByThreadId: {
      [thread.id]: Object.fromEntries(
        turnDiffSummaries.map((summary) => [summary.turnId, summary]),
      ),
    },
  };
}

export function makeProject(
  overrides: Partial<AppState["projects"][number]> = {},
): AppState["projects"][number] {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    kind: "project",
    name: "Project",
    remoteName: "Project",
    folderName: "project",
    localName: null,
    cwd: "/tmp/project",
    defaultModelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    expanded: true,
    spaceId: null,
    ...overrides,
  };
}

export function makeReadModelThread(overrides: Partial<OrchestrationReadModel["threads"][number]>) {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5.3-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,

    envMode: "local",
    branch: null,
    worktreePath: null,
    forkSourceThreadId: null,
    latestTurn: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    handoff: null,
    messages: [],
    activities: [],

    checkpoints: [],
    session: null,
    ...overrides,
  } satisfies OrchestrationReadModel["threads"][number];
}

export const threadsOf = getThreadsFromState;

export function makeFakeWindow(storage: Map<string, string>): {
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: Mock<(key: string, value: string) => void>;
  };
  addEventListener: Mock<() => void>;
} {
  const setItem = vi.fn((key: string, value: string) => {
    storage.set(key, value);
  });
  return {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem,
    },
    addEventListener: vi.fn(),
  };
}
