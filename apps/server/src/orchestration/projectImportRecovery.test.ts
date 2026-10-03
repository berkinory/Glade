import { captureProjectImport } from "./projectImportCapture";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, MessageId, ThreadId, ProjectId } from "@glade/contracts/core/baseSchemas";
import { DEFAULT_SERVER_SETTINGS } from "@glade/contracts/settings/settings";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { expect, it, vi } from "vitest";
import { ServerConfig } from "../server/config";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { makeProjectImportRepository } from "../persistence/projectImportRepository";
import type { ProviderAdapterRegistryShape } from "../provider/Services/ProviderAdapterRegistry";
import type { ProviderServiceShape } from "../provider/Services/ProviderService";
import type { ServerSettingsShape } from "../settings/serverSettings";
import { OrchestrationEngineLive } from "./Layers/OrchestrationEngine";
import { OrchestrationProjectionPipelineLive } from "./Layers/ProjectionPipeline";
import { OrchestrationProjectionSnapshotQueryLive } from "./Layers/ProjectionSnapshotQuery";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine";
import { makeProjectImportHandlers } from "./projectImportRoute";

it.each(["pending", "completed"] as const)(
  "recovers a deleted %s import with durable reservations and command receipts",
  async (status) => {
    const runtime = ManagedRuntime.make(
      OrchestrationEngineLive.pipe(
        Layer.provide(OrchestrationProjectionPipelineLive),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(OrchestrationEventStoreLive),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
        Layer.provideMerge(SqlitePersistenceMemory),
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "glade-project-import-recovery-" }),
        ),
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    try {
      const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
      const repository = await runtime.runPromise(makeProjectImportRepository);
      const createdAt = "2026-09-16T00:00:00.000Z";
      const readHistory = vi.fn(({ threadId }: { threadId: string }) =>
        Effect.succeed({
          messages: [
            {
              messageId: MessageId.makeUnsafe(`import:${threadId}:message`),
              role: "user" as const,
              text: "Original conversation",
              createdAt,
              updatedAt: createdAt,
            },
          ],
          nextCursor: null,
          sourceIds: ["message"],
        }),
      );
      const copy = vi.fn(({ threadId }: { threadId: string }) =>
        Effect.succeed({ threadId, resumeCursor: { threadId: `copy:${threadId}` } }),
      );
      const handlers = makeProjectImportHandlers({
        repository,
        orchestrationEngine: engine,
        providerService: {
          importExternalThread: copy,
          stopRuntimeSession: () => Effect.void,
        } as unknown as ProviderServiceShape,
        providerAdapterRegistry: {
          getByProvider: () =>
            Effect.succeed({
              listModels: () =>
                Effect.succeed({
                  models: [{ slug: "gpt-6.1-sol", name: "GPT-6.1 Sol", isDefault: true }],
                  source: "test",
                }),
            }),
        } as unknown as ProviderAdapterRegistryShape,
        serverSettings: {
          getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
        } as unknown as ServerSettingsShape,
        discover: async () => ({
          sourceHome: "/codex",
          projects: [{ id: "source-project", title: "Source project", roots: [process.cwd()] }],
          sessions: [
            {
              id: "source-thread",
              projectId: "source-project",
              title: "Source conversation",
              cwd: process.cwd(),
              createdAt,
              updatedAt: createdAt,
              archived: true,
            },
          ],
        }),
        readHistory,
      });
      const preview = () =>
        runtime.runPromise(handlers.listProjectImports({ providers: ["codex"] }));
      const project = (await preview()).projects[0]!;
      const input = { projectKey: project.key, threadKey: project.threads[0]!.key };
      if (status === "pending") {
        const complete = repository.complete;
        repository.complete = vi
          .fn(complete)
          .mockReturnValueOnce(Effect.die("interrupted completion"));
        await expect(runtime.runPromise(handlers.importProject(input))).rejects.toThrow(
          "interrupted completion",
        );
      } else {
        await runtime.runPromise(handlers.importProject(input));
      }
      const original = (await runtime.runPromise(repository.find(input.threadKey)))!;
      expect(original.status).toBe(status);
      await runtime.runPromise(
        engine.dispatch({
          type: "thread.delete",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          threadId: original.threadId,
        }),
      );

      await runtime.runPromise(engine.refreshCommandReadModel());
      expect((await preview()).projects[0]!.threads[0]!.alreadyImported).toBe(false);

      const replacement = await runtime.runPromise(handlers.importProject(input));

      expect(replacement.status).toBe("imported");
      expect(replacement.threadId).not.toBe(original.threadId);
      expect(copy).toHaveBeenCalledTimes(2);
      expect(await runtime.runPromise(repository.find(input.threadKey))).toMatchObject({
        threadId: replacement.threadId,
        status: "completed",
      });
      const active = (await runtime.runPromise(engine.getReadModel())).threads.filter(
        (thread) => thread.deletedAt === null,
      );
      expect(active).toHaveLength(1);
      expect(active[0]?.messages.map((message) => message.text)).toEqual(["Original conversation"]);
      expect(active[0]?.archivedAt).not.toBeNull();
      expect((await preview()).projects[0]!.threads[0]!.alreadyImported).toBe(true);
      await expect(runtime.runPromise(handlers.importProject(input))).resolves.toMatchObject({
        threadId: replacement.threadId,
        status: "already-present",
      });
    } finally {
      await runtime.dispose();
    }
  },
);

it.each(["before-dispatch", "after-dispatch"] as const)(
  "replays a frozen page after a crash %s and serves repeatable older history without provider turns",
  async (crashAt) => {
    const runtime = ManagedRuntime.make(
      OrchestrationEngineLive.pipe(
        Layer.provide(OrchestrationProjectionPipelineLive),
        Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(OrchestrationEventStoreLive),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
        Layer.provideMerge(SqlitePersistenceMemory),
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "glade-import-page-recovery-" }),
        ),
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    try {
      const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
      const snapshot = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
      const repository = await runtime.runPromise(makeProjectImportRepository);
      const threadId = ThreadId.makeUnsafe("paged-import");
      const projectId = ProjectId.makeUnsafe("paged-project");
      const createdAt = "2026-09-16T00:00:00.000Z";
      await runtime.runPromise(
        engine.dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe("create-project"),
          projectId,
          title: "Pages",
          workspaceRoot: "/tmp/paged-import",
          createdAt,
        }),
      );
      await runtime.runPromise(
        repository.reserve({
          sourceKey: "source",
          provider: "codex",
          sourceHome: "/isolated",
          externalId: "source",
          threadId,
          projectId,
          status: "pending",
          createdAt,
        }),
      );
      await runtime.runPromise(
        engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe("create-thread"),
          threadId,
          projectId,
          title: "Pages",
          modelSelection: { provider: "codex", model: "gpt-6.1-sol" },
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt,
        }),
      );
      const readPage = vi.fn((cursor: string | null) => {
        const page = Number(cursor ?? 0);
        return Effect.succeed({
          sourceIds: [`source-${page}`],
          nextCursor: page < 2 ? String(page + 1) : null,
          messages: Array.from({ length: 250 }, (_, index) => ({
            messageId: MessageId.makeUnsafe(`import:${threadId}:codex:${page * 250 + index}`),
            role: "user" as const,
            text: `Original ${page * 250 + index}`,
            createdAt: index % 2 ? "2026-09-15T23:59:00.000Z" : createdAt,
            updatedAt: createdAt,
          })),
        });
      });
      const legacy = await runtime.runPromise(readPage(null));
      await runtime.runPromise(
        engine.dispatch({
          type: "thread.messages.import",
          commandId: CommandId.makeUnsafe(`project-import:${threadId}:messages:0`),
          threadId,
          messages: legacy.messages.slice(0, 50),
          createdAt,
        }),
      );
      readPage.mockClear();
      const crashEngine = { ...engine };
      const dispatch = engine.dispatch;
      const applied = repository.history.applied;
      if (crashAt === "before-dispatch")
        crashEngine.dispatch = vi
          .fn(dispatch)
          .mockReturnValueOnce(Effect.die("crash before dispatch"));
      else
        repository.history.applied = vi
          .fn(applied)
          .mockReturnValueOnce(Effect.die("crash after dispatch"));
      const capture = () =>
        captureProjectImport({
          threadId,
          nativeId: "independent-copy",
          createdAt,
          repository: repository.history,
          engine: crashEngine,
          readPage,
        });
      await expect(runtime.runPromise(capture())).rejects.toThrow("crash");
      expect(
        (await runtime.runPromise(repository.history.pages(threadId)))[0]?.messages[0]?.text,
      ).toBe("Original 0");
      crashEngine.dispatch = dispatch;
      repository.history.applied = applied;
      await runtime.runPromise(capture());
      await runtime.runPromise(repository.complete("source"));
      expect(readPage.mock.calls.map(([cursor]) => cursor)).toEqual([null, "1", "2"]);
      const full = Option.getOrThrow(
        await runtime.runPromise(snapshot.getThreadDetailForExportById(threadId)),
      );
      expect(full.messages).toHaveLength(750);
      expect(new Set(full.messages.map((message) => message.id)).size).toBe(750);
      expect(full.messages.slice(0, 2).map((message) => message.createdAt)).toEqual([
        createdAt,
        "2026-09-15T23:59:00.000Z",
      ]);
      const recent = Option.getOrThrow(
        await runtime.runPromise(snapshot.getThreadDetailById(threadId)),
      );
      expect(recent.messages).toHaveLength(10);
      expect(recent.messages[0]?.text).toBe("Original 740");
      const input = { threadId, beforeMessageId: recent.messages[0]!.id, cursor: null };
      const probe = await runtime.runPromise(
        repository.readImportedHistory({ ...input, probe: true }),
      );
      const background = await runtime.runPromise(
        repository.readImportedHistory({ ...input, cursor: probe.nextCursor, limit: 15 }),
      );
      expect(background.messages).toHaveLength(15);
      expect(background.messages[0]?.text).toBe("Original 725");
      expect(background.messages.at(-1)?.text).toBe("Original 739");
      const [first, duplicate] = await Promise.all([
        runtime.runPromise(repository.readImportedHistory(input)),
        runtime.runPromise(repository.readImportedHistory(input)),
      ]);
      expect(first).toEqual(duplicate);
      expect(first.messages[0]?.text).toBe("Original 640");
      expect(first.messages.at(-1)?.text).toBe("Original 739");
      await expect(
        runtime.runPromise(
          repository.readImportedHistory({
            ...input,
            cursor: Buffer.from(
              JSON.stringify({ version: 1, threadId: "another-thread", sequence: 1 }),
            ).toString("base64url"),
          }),
        ),
      ).rejects.toThrow("another conversation");
      const second = await runtime.runPromise(
        repository.readImportedHistory({ ...input, cursor: first.nextCursor }),
      );
      expect(second.messages[0]?.text).toBe("Original 540");
      await runtime.runPromise(
        engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe("continue-import"),
          threadId,
          runtimeMode: "approval-required",
          message: {
            messageId: MessageId.makeUnsafe("continue-import"),
            role: "user",
            text: "Continue after import",
            attachments: [],
          },
          createdAt,
        }),
      );
      expect(await runtime.runPromise(repository.readImportedHistory(input))).toEqual(first);

      expect(
        Option.getOrThrow(await runtime.runPromise(snapshot.getThreadDetailForExportById(threadId)))
          .messages,
      ).toHaveLength(751);
      await runtime.runPromise(
        engine.dispatch({
          type: "thread.delete",
          commandId: CommandId.makeUnsafe("delete"),
          threadId,
        }),
      );
      expect(await runtime.runPromise(repository.history.pages(threadId))).toEqual([]);
      await expect(
        runtime.runPromise(repository.readImportedHistory({ ...input, cursor: first.nextCursor })),
      ).rejects.toThrow("no longer available");
    } finally {
      await runtime.dispose();
    }
  },
);
