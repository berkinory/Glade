import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ProjectId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationSessionStatus } from "@glade/contracts/orchestration/threadEntities";
import type { ProviderSession } from "@glade/contracts/provider/provider";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { hasPeerTurnInCheckout } from "./checkoutPeerActivity.ts";

const projectId = ProjectId.makeUnsafe("project-1");
const ownThreadId = ThreadId.makeUnsafe("reverting-thread");
const peerThreadId = ThreadId.makeUnsafe("peer-thread");
const now = new Date().toISOString();
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeRepo() {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), "glade-peer-checkout-"));
  tempDirs.push(container);
  const repo = path.join(container, "repo");
  fs.mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  return { container, repo, git };
}

type Location = "same" | "alias" | "nested" | "worktree";
type PeerState = "running" | "pending" | "pending-after-error" | "idle" | "provider-running";

function peerCwdFor(location: Location, setup: ReturnType<typeof makeRepo>): string {
  switch (location) {
    case "same":
      return setup.repo;
    case "alias": {
      const alias = path.join(setup.container, "alias");
      fs.symlinkSync(setup.repo, alias, "dir");
      return alias;
    }
    case "nested": {
      const nested = path.join(setup.repo, "nested");
      fs.mkdirSync(nested);
      return nested;
    }
    case "worktree": {
      const worktree = path.join(setup.container, "worktree");
      setup.git("worktree", "add", "-q", "--detach", worktree, "HEAD");
      return worktree;
    }
  }
}

function peerThread(cwd: string, state: PeerState) {
  const sessionStatus: OrchestrationSessionStatus =
    state === "running" ? "running" : state === "pending-after-error" ? "error" : "idle";
  return {
    id: peerThreadId,
    deletedAt: null,
    projectId,
    envMode: "worktree" as const,
    worktreePath: cwd,
    workingDirectory: null,
    session: {
      threadId: peerThreadId,
      status: sessionStatus,
      providerName: "codex",
      runtimeMode: "full-access" as const,
      activeTurnId: state === "running" ? TurnId.makeUnsafe("peer-turn") : null,
      lastError: null,
      updatedAt: now,
    },
    latestTurn: null,
  };
}

function providerSession(threadId: ThreadId, cwd: string): ProviderSession {
  return {
    provider: "codex",
    status: "running",
    runtimeMode: "full-access",
    cwd,
    threadId,
    activeTurnId: TurnId.makeUnsafe("provider-turn"),
    createdAt: now,
    updatedAt: now,
  };
}

describe("hasPeerTurnInCheckout", () => {
  it.each([
    { location: "same", state: "running", blocked: true },
    { location: "alias", state: "running", blocked: true },
    { location: "nested", state: "running", blocked: true },
    { location: "worktree", state: "running", blocked: false },
    { location: "same", state: "pending", blocked: true },
    { location: "same", state: "pending-after-error", blocked: false },
    { location: "same", state: "idle", blocked: false },
    { location: "alias", state: "provider-running", blocked: true },
    { location: "worktree", state: "provider-running", blocked: false },
  ] satisfies ReadonlyArray<{ location: Location; state: PeerState; blocked: boolean }>)(
    "peer $state in $location checkout blocks: $blocked",
    async ({ location, state, blocked }) => {
      const setup = makeRepo();
      const peerCwd = peerCwdFor(location, setup);
      const result = await Effect.runPromise(
        hasPeerTurnInCheckout({
          cwd: setup.repo,
          ownThreadIds: [ownThreadId],
          readModel: {
            threads: state === "provider-running" ? [] : [peerThread(peerCwd, state)],
            projects: [{ id: projectId, kind: "project", workspaceRoot: setup.repo }],
          },
          providerSessions: [
            providerSession(ownThreadId, setup.repo),
            ...(state === "provider-running" ? [providerSession(peerThreadId, peerCwd)] : []),
          ],
          hasPendingTurnStart: (threadId) =>
            Effect.succeed(threadId === peerThreadId && state.startsWith("pending")),
        }),
      );
      expect(result).toBe(blocked);
    },
  );
});
