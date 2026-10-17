import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, FileSystem, Layer, ManagedRuntime, Option, Path } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCoreLive } from "../git/Layers/GitCore";
import { GitCore } from "../git/Services/GitCore";
import {
  createOrchestrationSystem,
  createProjectCommand,
  createThreadCommand,
} from "../orchestration/testing/orchestrationEngineSystem";
import { ServerConfig } from "../server/config";
import { makeThreadWorkspaceTool } from "./threadWorkspaceTool";
import type { ToolContext } from "./toolRuntime";

const threadId = ThreadId.makeUnsafe("workspace-caller");
const context: ToolContext = {
  principal: {
    kind: "provider-session",
    sessionKey: "workspace-session",
    threadId,
    provider: "codex",
    turnId: "workspace-turn",
  },
  callerThreadId: threadId,
  callerThreadLabel: null,
  callerSessionKey: "workspace-session",
  callerProvider: "codex",
  callerCapabilities: new Set(["thread:read", "thread:write"]),
  callerTurnId: "workspace-turn",
  assertCallerTurnActive: () => Effect.void,
  jsonRpcRequestId: 1,
};

async function makeWorkspace() {
  const system = await createOrchestrationSystem();
  const runtime = ManagedRuntime.make(
    GitCoreLive.pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "glade-workspace-tool-" })),
      Layer.provideMerge(NodeServices.layer),
    ),
  );
  const fs = await runtime.runPromise(Effect.service(FileSystem.FileSystem));
  const path = await runtime.runPromise(Effect.service(Path.Path));
  const git = await runtime.runPromise(Effect.service(GitCore));
  const root = await runtime.runPromise(
    fs.makeTempDirectory({ prefix: "glade-workspace-tool-" }).pipe(Effect.flatMap(fs.realPath)),
  );
  const repo = path.join(root, "repo");
  const worktree = path.join(root, "worktree");
  const foreign = path.join(root, "foreign");
  const foreignWorktree = path.join(root, "foreign-worktree");
  const execute = (cwd: string, args: readonly string[]) =>
    runtime.runPromise(git.execute({ operation: "test.setup", cwd, args }));
  await runtime.runPromise(fs.makeDirectory(repo));
  await execute(repo, ["init", "--initial-branch=main"]);
  await execute(repo, [
    "-c",
    "user.name=Glade Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  ]);
  await execute(repo, ["worktree", "add", "-b", "task/workspace", worktree]);
  await execute(root, ["clone", "--no-hardlinks", repo, foreign]);
  await execute(foreign, ["worktree", "add", "-b", "task/foreign", foreignWorktree]);
  const nested = path.join(worktree, "nested");
  await runtime.runPromise(fs.makeDirectory(nested));
  const alias = path.join(root, "alias");
  await runtime.runPromise(fs.symlink(nested, alias));
  const escape = path.join(worktree, "escape");
  await runtime.runPromise(fs.symlink(foreignWorktree, escape));
  const createdAt = new Date().toISOString();
  await system.run(
    system.engine.dispatch(
      createProjectCommand({
        projectId: "workspace-project",
        workspaceRoot: repo,
        createdAt,
      }),
    ),
  );
  await system.run(
    system.engine.dispatch(
      createThreadCommand({
        projectId: "workspace-project",
        threadId,
        createdAt,
      }),
    ),
  );
  const tool = makeThreadWorkspaceTool(system.engine, system.snapshotQuery, git, fs, path);
  return {
    repo,
    worktree,
    nested,
    alias,
    foreignWorktree,
    escape,
    missing: path.join(root, "missing"),
    call: (target: string) => system.run(tool.handler({ path: target }, context)),
    snapshot: () =>
      system.run(system.snapshotQuery.getThreadShellById(threadId)).then(Option.getOrThrow),
    sequence: () => system.run(system.engine.getEventHighWaterSequence),
    dispose: async () => {
      await system.dispose();
      await runtime.runPromise(fs.remove(root, { recursive: true }));
      await runtime.dispose();
    },
  };
}

describe("thread workspace registration", () => {
  let workspace: Awaited<ReturnType<typeof makeWorkspace>>;
  beforeEach(async () => {
    workspace = await makeWorkspace();
  });
  afterEach(async () => {
    await workspace.dispose();
  });

  it("persists a canonical worktree and working directory from a symlinked subdirectory", async () => {
    const result = await workspace.call(workspace.alias);
    expect(result.isError).not.toBe(true);
    expect(await workspace.snapshot()).toMatchObject({
      envMode: "worktree",
      worktreePath: workspace.worktree,
      workingDirectory: workspace.nested,
      branch: "task/workspace",
      associatedWorktreePath: workspace.worktree,
      associatedWorktreeBranch: "task/workspace",
      associatedWorktreeRef: "task/workspace",
    });
  });

  it.each(["repo", "foreignWorktree", "escape", "missing", "relative"] as const)(
    "rejects %s without changing persisted thread state",
    async (target) => {
      const before = await workspace.snapshot();
      const sequence = await workspace.sequence();
      const result = await workspace.call(
        target === "relative" ? "../worktree" : workspace[target],
      );
      expect(result.isError).toBe(true);
      expect(await workspace.snapshot()).toEqual(before);
      expect(await workspace.sequence()).toBe(sequence);
    },
  );
});
