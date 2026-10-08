import { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  type OrchestrationReadModel,
  type OrchestrationShellSnapshot,
} from "@glade/contracts/orchestration/snapshots";
import { describe, expect, it } from "vitest";

import {
  hasLiveThreadsWithMissingProjects,
  shouldRepairDesktopProjectSnapshot,
} from "./desktopProjectRecovery";

function makeProject(
  overrides: Partial<OrchestrationReadModel["projects"][number]> = {},
): OrchestrationReadModel["projects"][number] {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    kind: "project",
    title: "Project",
    workspaceRoot: "/tmp/project",
    defaultModelSelection: {
      provider: "codex",
      model: "gpt-5.3-codex",
    },
    createdAt: "2026-04-20T08:00:00.000Z",
    updatedAt: "2026-04-20T08:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function makeThread(
  overrides: Partial<OrchestrationReadModel["threads"][number]> = {},
): OrchestrationReadModel["threads"][number] {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5.3-codex",
    },
    runtimeMode: "approval-required",

    envMode: "local",
    branch: null,
    worktreePath: null,
    associatedWorktreePath: null,
    associatedWorktreeBranch: null,
    associatedWorktreeRef: null,
    parentThreadId: null,
    subagentAgentId: null,
    subagentNickname: null,
    subagentRole: null,
    forkSourceThreadId: null,
    lastKnownPr: null,
    latestTurn: null,
    handoff: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,

    createdAt: "2026-04-20T08:00:00.000Z",
    updatedAt: "2026-04-20T08:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    activities: [],

    checkpoints: [],
    session: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<OrchestrationReadModel> = {}): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    spaces: [],
    updatedAt: "2026-04-20T08:00:00.000Z",
    projects: [makeProject()],
    threads: [makeThread()],
    ...overrides,
  };
}

function makeShellSnapshot(
  overrides: Partial<OrchestrationShellSnapshot> = {},
): OrchestrationShellSnapshot {
  const { deletedAt: _projectDeletedAt, ...project } = makeProject();
  const {
    deletedAt: _threadDeletedAt,
    messages: _messages,
    activities: _activities,
    checkpoints: _checkpoints,
    ...thread
  } = makeThread();
  return {
    snapshotSequence: 1,
    spaces: [],
    updatedAt: "2026-04-20T08:00:00.000Z",
    projects: [project],
    threads: [thread],
    ...overrides,
  };
}

const deletedAt = "2026-04-20T09:00:00.000Z";

describe("desktopProjectRecovery", () => {
  it.each([
    {
      name: "a valid empty first-run snapshot",
      snapshot: { projects: [], threads: [] },
      expected: false,
    },
    {
      name: "an empty shell the server marked for repair",
      snapshot: { requiresEmptyProjectShellRepair: true, projects: [], threads: [] },
      expected: true,
    },
    {
      name: "a populated shell even when marked for repair",
      snapshot: { requiresEmptyProjectShellRepair: true },
      expected: false,
    },
  ])("decides repair for $name", ({ snapshot, expected }) => {
    expect(shouldRepairDesktopProjectSnapshot(makeShellSnapshot(snapshot))).toBe(expected);
  });

  it.each([
    { name: "live threads with live project rows", snapshot: makeSnapshot(), expected: false },
    {
      name: "a live thread whose project row is missing",
      snapshot: makeSnapshot({ projects: [] }),
      expected: true,
    },
    {
      name: "a live thread whose project row is deleted",
      snapshot: makeSnapshot({ projects: [makeProject({ deletedAt })] }),
      expected: true,
    },
    {
      name: "only deleted threads",
      snapshot: makeSnapshot({ projects: [], threads: [makeThread({ deletedAt })] }),
      expected: false,
    },
    {
      name: "a shell snapshot without deleted markers",
      snapshot: makeShellSnapshot(),
      expected: false,
    },
    {
      name: "a shell snapshot missing project rows",
      snapshot: makeShellSnapshot({ projects: [] }),
      expected: true,
    },
  ])("detects missing projects for $name", ({ snapshot, expected }) => {
    expect(hasLiveThreadsWithMissingProjects(snapshot)).toBe(expected);
  });
});
