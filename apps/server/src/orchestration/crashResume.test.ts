import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { MessageId, ProjectId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { Effect, Option } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectionPendingInteractionRepository } from "../persistence/Services/ProjectionPendingInteractions.ts";
import { ServerConfig } from "../server/config.ts";
import {
  captureCrashInterruptedChats,
  getCrashResumeOffer,
  resolveCrashResume,
} from "./crashResume.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

const PROJECT_ID = ProjectId.makeUnsafe("project");

const runningChat = (
  id: string,
  overrides: Record<string, unknown> = {},
  message: { readonly id?: string; readonly dispatchOrigin?: string } = {},
) => ({
  id: ThreadId.makeUnsafe(id),
  title: `Chat ${id}`,
  projectId: PROJECT_ID,
  runtimeMode: "full-access",
  deletedAt: null,
  archivedAt: null,
  parentThreadId: null,
  creationSource: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  session: { status: "running", activeTurnId: TurnId.makeUnsafe(`${id}-turn`) },
  latestTurn: {
    turnId: TurnId.makeUnsafe(`${id}-turn`),
    state: "running",
    completedAt: null,
  },
  messages: [
    {
      id: MessageId.makeUnsafe(message.id ?? `${id}-message`),
      role: "user",
      turnId: TurnId.makeUnsafe(`${id}-turn`),
      dispatchOrigin: message.dispatchOrigin ?? "user",
    },
  ],
  ...overrides,
});

// Restart reconciliation leaves every orphaned turn interrupted and its session idle.
const afterReconciliation = (thread: ReturnType<typeof runningChat>) => ({
  ...thread,
  session: { status: "interrupted", activeTurnId: null },
  latestTurn: { ...thread.latestTurn, state: "interrupted" },
});

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("crash resume", () => {
  it("offers only ordinary interrupted chats and continues just the chosen ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glade-crash-resume-"));
    tempDirs.push(dir);
    const threads = [
      runningChat("ordinary"),
      runningChat("also-ordinary"),
      runningChat("awaiting-approval", { hasPendingApprovals: true }),
      runningChat("awaiting-answer", { hasPendingUserInput: true }),
      runningChat("open-callback"),
      runningChat("subagent", { parentThreadId: ThreadId.makeUnsafe("ordinary") }),
      runningChat("gateway-created", { creationSource: "glade_mcp" }),
      runningChat("delegated", {}, { id: "agent:abc:message", dispatchOrigin: "agent" }),
      runningChat("scheduled", {}, { dispatchOrigin: "automation" }),
      runningChat("finished", {
        latestTurn: { turnId: TurnId.makeUnsafe("finished-turn"), state: "completed" },
      }),
    ];
    let readModelThreads: ReadonlyArray<unknown> = threads;
    const dispatch = vi.fn((_command: unknown) => Effect.succeed({ sequence: 1 }));

    const run = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | ServerConfig
        | OrchestrationEngineService
        | ProjectionSnapshotQuery
        | ProjectionPendingInteractionRepository
        | NodeServices.NodeServices
      >,
    ) =>
      Effect.runPromise(
        effect.pipe(
          Effect.provideService(ServerConfig, {
            crashResumeStatePath: join(dir, "crash-resume.json"),
          } as never),
          Effect.provideService(OrchestrationEngineService, {
            getReadModel: () =>
              Effect.succeed({
                threads: readModelThreads,
                projects: [{ id: PROJECT_ID, deletedAt: null }],
              }),
            dispatch,
          } as never),
          Effect.provideService(ProjectionSnapshotQuery, {
            getThreadDetailById: (threadId: ThreadId) =>
              Effect.succeed(
                Option.fromNullishOr(threads.find((thread) => thread.id === threadId)),
              ),
          } as never),
          Effect.provideService(ProjectionPendingInteractionRepository, {
            listUnsettled: () =>
              Effect.succeed([{ threadId: ThreadId.makeUnsafe("open-callback") }]),
          } as never),
          Effect.provide(NodeServices.layer),
        ),
      );

    await run(captureCrashInterruptedChats);
    readModelThreads = threads.map(afterReconciliation);

    const offer = await run(getCrashResumeOffer);
    expect(offer.chats.map((chat) => chat.threadId).toSorted()).toEqual([
      "also-ordinary",
      "ordinary",
    ]);

    const result = await run(
      resolveCrashResume({
        continueThreadIds: [ThreadId.makeUnsafe("ordinary")],
        continuationPrompt: "Check the workspace, then continue.",
      }),
    );
    expect(result.continuedThreadIds).toEqual(["ordinary"]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "thread.turn.start",
      threadId: "ordinary",
      commandId: "crash-resume:ordinary-turn:ordinary",
      message: { text: "Check the workspace, then continue." },
      resumePrecondition: { recordedTurnId: "ordinary-turn" },
    });
    expect((await run(getCrashResumeOffer)).chats).toEqual([]);
  });
});
