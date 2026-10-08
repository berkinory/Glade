import { type ProjectId } from "@glade/contracts/core/baseSchemas";
import { describe, expect, it } from "vitest";

import type { Project } from "../types";
import { resolveFirstSendTarget } from "./chatFirstSend";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-home" as ProjectId,
    kind: "chat",
    name: "Home",
    remoteName: "Home",
    folderName: "tester",
    localName: null,
    cwd: "/Users/tester",
    defaultModelSelection: null,
    expanded: false,
    spaceId: null,
    ...overrides,
  };
}

const appProject = makeProject({ id: "project-app" as ProjectId, kind: "project" });
const baseInput = {
  defaultModelSelection: { provider: "codex" as const, model: "gpt-6.1-sol" },
  activeProject: makeProject(),
  chatWorkspaceRoot: "/Users/tester/Documents/Glade",
  createdAt: new Date(2026, 5, 11, 23, 30, 43),
  isFirstMessage: true,
  isHomeChatContainer: true,
  projects: [makeProject()],
  selectedWorkspaceRoot: null,
};

describe("resolveFirstSendTarget", () => {
  it.each([
    {
      name: "creates a managed date/slug chat project for a plain general chat first send",
      input: { title: "Yes it takes", titleSeed: "Yes, it takes all the skills!" },
      expected: {
        kind: "create-project",
        creation: {
          workspaceRoot: "/Users/tester/Documents/Glade/2026-06-11/yes-it-takes-all-the-skills",
          title: "Yes it takes",
          kind: "chat",
          createWorkspaceRootIfMissing: true,
        },
      },
    },
    {
      name: "keeps folder mentions as ordinary projects",
      input: {
        selectedWorkspaceRoot: "/Users/tester/Developer/app",
        title: "Use app",
        titleSeed: "Use app",
      },
      expected: {
        kind: "create-project",
        creation: {
          workspaceRoot: "/Users/tester/Developer/app",
          title: "app",
          kind: "project",
          createWorkspaceRootIfMissing: false,
        },
      },
    },
    {
      name: "uses the current project outside a home chat first send",
      input: {
        activeProject: appProject,
        projects: [appProject],
        isFirstMessage: false,
        isHomeChatContainer: false,
        title: "Follow up",
        titleSeed: "Follow up",
      },
      expected: {
        kind: "current",
        target: { targetProjectId: "project-app", targetProjectKind: "project" },
      },
    },
  ])("$name", ({ input, expected }) => {
    expect(resolveFirstSendTarget({ ...baseInput, ...input })).toMatchObject(expected);
  });
});
