import { ProjectId } from "@glade/contracts/core/baseSchemas";
import { describe, expect, it } from "vitest";

import {
  type DuplicateProjectCreateRecoveryCandidate,
  findRecoverableProject,
  findRecoverableProjectForDuplicateCreate,
  waitForRecoverableProjectInReadModel,
  waitForRecoverableProjectForDuplicateCreate,
} from "./projectCreateRecovery";

const WORKSPACE_ROOT = "/Users/tester/Code/one";
const DUPLICATE_MESSAGE = `Orchestration command invariant failed (project.create): Project 'project-123' already uses workspace root '${WORKSPACE_ROOT}'.`;

describe("projectCreateRecovery", () => {
  it("finds a recoverable project by exact id before falling back to workspace root", () => {
    const recovered = findRecoverableProject({
      projectId: "project-123",
      workspaceRoot: WORKSPACE_ROOT,
      projects: [
        {
          id: "project-123",
          kind: "project",
          workspaceRoot: "/Users/tester/Code/two",
          deletedAt: null,
        },
        {
          id: "project-456",
          kind: "project",
          workspaceRoot: WORKSPACE_ROOT,
          deletedAt: null,
        },
      ],
    });

    expect(recovered?.id).toBe("project-123");
  });

  it.each<{
    name: string;
    projects: DuplicateProjectCreateRecoveryCandidate[];
    expected: string | null;
  }>([
    {
      name: "falls back to workspace-root matching when the duplicate id is not available locally",
      projects: [
        {
          id: "project-456",
          kind: "project",
          workspaceRoot: `${WORKSPACE_ROOT}/`,
          deletedAt: null,
        },
      ],
      expected: "project-456",
    },
    {
      name: "treats a missing kind like a normal project",
      projects: [{ id: "project-123", workspaceRoot: WORKSPACE_ROOT, deletedAt: null }],
      expected: "project-123",
    },
    {
      name: "recovers active shell-snapshot projects that do not carry deletedAt",
      projects: [{ id: "project-123", kind: "project", workspaceRoot: WORKSPACE_ROOT }],
      expected: "project-123",
    },
    {
      name: "ignores deleted and non-project rows",
      projects: [
        { id: "project-123", kind: "chat", workspaceRoot: WORKSPACE_ROOT, deletedAt: null },
        {
          id: "project-789",
          kind: "project",
          workspaceRoot: WORKSPACE_ROOT,
          deletedAt: "2026-04-18T10:00:00.000Z",
        },
      ],
      expected: null,
    },
  ])("$name", ({ projects, expected }) => {
    expect(
      findRecoverableProjectForDuplicateCreate({
        message: DUPLICATE_MESSAGE,
        projects,
        workspaceRoot: WORKSPACE_ROOT,
      })?.id ?? null,
    ).toBe(expected);
  });

  it("retries snapshot reads before giving up on duplicate recovery", async () => {
    let attempts = 0;

    const result = await waitForRecoverableProjectForDuplicateCreate({
      message: DUPLICATE_MESSAGE,
      workspaceRoot: WORKSPACE_ROOT,
      loadSnapshot: async () => {
        attempts += 1;
        if (attempts < 3) {
          return {
            projects: [],
          };
        }

        return {
          projects: [
            {
              id: "project-123",
              workspaceRoot: WORKSPACE_ROOT,
              deletedAt: null,
            },
          ],
        };
      },
      maxAttempts: 3,
      delayMs: 0,
    });

    expect(attempts).toBe(3);
    expect(result.project?.id).toBe("project-123");
    expect(result.snapshot?.projects).toHaveLength(1);
  });

  it("repairs the snapshot after polling when a directly created project is still missing", async () => {
    let repairCalls = 0;

    const result = await waitForRecoverableProjectInReadModel({
      projectId: "project-123",
      workspaceRoot: WORKSPACE_ROOT,
      loadSnapshot: async () => ({
        snapshotSequence: 1,
        spaces: [],
        updatedAt: "2026-04-21T00:00:00.000Z",
        projects: [],
        threads: [],
      }),
      repairSnapshot: async () => {
        repairCalls += 1;
        return {
          snapshotSequence: 2,
          spaces: [],
          updatedAt: "2026-04-21T00:00:01.000Z",
          projects: [
            {
              id: ProjectId.makeUnsafe("project-123"),
              kind: "project",
              title: "One",
              workspaceRoot: WORKSPACE_ROOT,
              defaultModelSelection: null,
              createdAt: "2026-04-21T00:00:00.000Z",
              updatedAt: "2026-04-21T00:00:01.000Z",
              deletedAt: null,
            },
          ],
          threads: [],
        };
      },
      maxAttempts: 2,
      delayMs: 0,
    });

    expect(repairCalls).toBe(1);
    expect(result.project?.id).toBe("project-123");
    expect(result.snapshot?.projects).toHaveLength(1);
  });

  it("repairs duplicate-create recovery when the fresh snapshot still has no project rows", async () => {
    let repairCalls = 0;

    const result = await waitForRecoverableProjectForDuplicateCreate({
      message: DUPLICATE_MESSAGE,
      workspaceRoot: WORKSPACE_ROOT,
      loadSnapshot: async () => ({
        projects: [],
      }),
      repairSnapshot: async () => {
        repairCalls += 1;
        return {
          projects: [
            {
              id: "project-123",
              workspaceRoot: WORKSPACE_ROOT,
              deletedAt: null,
            },
          ],
        };
      },
      maxAttempts: 2,
      delayMs: 0,
    });

    expect(repairCalls).toBe(1);
    expect(result.project?.id).toBe("project-123");
    expect(result.snapshot?.projects).toHaveLength(1);
  });
});
