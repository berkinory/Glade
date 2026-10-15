import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { expect, it } from "vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import {
  VisualReply,
  VISUAL_REPLY_ACTIVITY_KIND,
} from "@glade/contracts/orchestration/visualReply";
import { PublishedVisualReply } from "@glade/contracts/orchestration/visualComponents";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { ManagedAttachmentRepository } from "../persistence/Services/ManagedAttachments";
import { ServerConfig } from "../server/config";
import { makeVisualReplyTools } from "../agentGateway/visualReplyTools";
import type { ToolContext } from "../agentGateway/toolRuntime";
import { VisualReplyPreviewLive } from "./Layers/VisualReplyPreview";
import { VisualReplyPreview } from "./Services/VisualReplyPreview";

it("publishes owned HTML and component specs, retains them through replay and forks, and prunes them with their turn", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "glade-visual-persistence-"));
  const runtime = ManagedRuntime.make(
    OrchestrationEngineLive.pipe(
      Layer.provideMerge(VisualReplyPreviewLive),
      Layer.provideMerge(OrchestrationProjectionPipelineLive),
      Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provideMerge(ServerConfig.layerTest(workspace, { prefix: "glade-visual-data-" })),
      Layer.provideMerge(NodeServices.layer),
    ),
  );
  try {
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const attachments = await runtime.runPromise(Effect.service(ManagedAttachmentRepository));
    const snapshots = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
    const config = await runtime.runPromise(Effect.service(ServerConfig));
    const preview = await runtime.runPromise(Effect.service(VisualReplyPreview));
    const projectId = ProjectId.makeUnsafe("visual-project");
    const threadId = ThreadId.makeUnsafe("visual-thread");
    const turnId = TurnId.makeUnsafe("visual-turn");
    const createdAt = new Date().toISOString();
    let index = 0;
    const commandId = () => CommandId.makeUnsafe(`visual-command-${++index}`);
    await runtime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: commandId(),
        projectId,
        title: "Visuals",
        kind: "chat",
        workspaceRoot: workspace,
        defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
        createdAt,
      }),
    );
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: commandId(),
        threadId,
        projectId,
        title: "Visual",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: commandId(),
        threadId,
        messageId: MessageId.makeUnsafe("visual-assistant"),
        turnId,
        createdAt,
      }),
    );
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.session.set",
        commandId: commandId(),
        threadId,
        session: {
          threadId,
          providerName: "codex",
          status: "running",
          activeTurnId: turnId,
          runtimeMode: "approval-required",
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );
    const principal = { ownerKind: "session" as const, ownerId: "agent:visual-session" };
    const context: ToolContext = {
      principal: {
        kind: "provider-session",
        sessionKey: "visual-session",
        threadId,
        provider: "codex",
        turnId,
      },
      callerThreadId: threadId,
      callerThreadLabel: "Visual",
      callerSessionKey: "visual-session",
      callerProvider: "codex",
      callerCapabilities: new Set(["thread:write"]),
      callerTurnId: turnId,
      assertCallerTurnActive: () => Effect.void,
      jsonRpcRequestId: 1,
    };
    const tools = makeVisualReplyTools({ preview, snapshots, engine, attachments, config });
    const render = tools.find((tool) => tool.definition.name === "html_render")!;
    const renderComponents = tools.find((tool) => tool.definition.name === "components_render")!;
    const blocks = [
      { type: "stats", items: [{ label: "Pass rate", value: "98%" }] },
      { type: "choices", options: [{ label: "Fix the flaky test" }] },
    ];
    const rejected = await runtime.runPromise(
      renderComponents.handler(
        { title: "Spec", blocks: [{ type: "table", columns: ["A"], rows: [["a", "b"]] }] },
        context,
      ),
    );
    expect(rejected.isError).toBe(true);
    const published = await runtime.runPromise(
      renderComponents.handler({ title: "Spec", blocks }, context),
    );
    expect(published.isError, JSON.stringify(published)).not.toBe(true);
    const componentReplies = (id: ThreadId) =>
      runtime.runPromise(snapshots.getThreadDetailById(id)).then((thread) =>
        Option.getOrThrow(thread).activities.flatMap((entry) => {
          if (entry.kind !== VISUAL_REPLY_ACTIVITY_KIND) return [];
          const reply = Schema.decodeUnknownSync(PublishedVisualReply)(entry.payload);
          return "format" in reply ? [reply] : [];
        }),
      );
    expect(await componentReplies(threadId)).toMatchObject([{ threadId, title: "Spec", blocks }]);
    const result = await runtime.runPromise(
      render.handler(
        {
          title: "Chart",
          height: 340,
          html: '<h1>Persisted chart</h1><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="20"/></svg>',
        },
        context,
      ),
    );
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const activity = Option.getOrThrow(
      await runtime.runPromise(snapshots.getThreadDetailById(threadId)),
    ).activities.find(
      (entry) => entry.kind === VISUAL_REPLY_ACTIVITY_KIND && Schema.is(VisualReply)(entry.payload),
    )!;
    const reply = Schema.decodeUnknownSync(VisualReply)(activity.payload);
    expect(reply.height).toBe(340);
    const claimed = Option.getOrThrow(
      await runtime.runPromise(attachments.findClaimedById({ attachmentId: reply.attachmentId })),
    );
    expect(claimed.ownerId).toBe(principal.ownerId);
    expect(claimed.claimMessageId).toBe(activity.id);
    expect(
      await fs.readFile(path.join(config.attachmentsDir, claimed.relativePath), "utf8"),
    ).toContain("Persisted chart");
    const retry = {
      type: "thread.activity.append" as const,
      commandId: commandId(),
      threadId,
      activity: { ...activity, id: EventId.makeUnsafe("visual-owner-retry") },
      createdAt,
    };
    await expect(
      runtime.runPromise(
        engine.dispatch(retry, {
          attachmentPrincipal: { ownerKind: "session", ownerId: "another-session" },
        }),
      ),
    ).rejects.toThrow("another owner");
    await runtime.runPromise(engine.repairState());
    expect(
      Option.isSome(
        await runtime.runPromise(attachments.findClaimedById({ attachmentId: reply.attachmentId })),
      ),
    ).toBe(true);
    expect(
      Option.getOrThrow(
        await runtime.runPromise(snapshots.getThreadDetailById(threadId)),
      ).activities.some((entry) => entry.id === activity.id),
    ).toBe(true);
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.session.set",
        commandId: commandId(),
        threadId,
        session: {
          threadId,
          providerName: "codex",
          status: "ready",
          activeTurnId: null,
          runtimeMode: "approval-required",
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );
    const stale = await runtime.runPromise(
      render.handler({ title: "Late chart", html: "<h1>Late</h1>" }, context),
    );
    expect(stale.isError).toBe(true);
    const forkMessageId = MessageId.makeUnsafe("visual-final");
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: commandId(),
        threadId,
        messageId: forkMessageId,
        turnId,
        createdAt: new Date().toISOString(),
      }),
    );
    const forkThreadId = ThreadId.makeUnsafe("visual-fork");
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.fork.create",
        commandId: commandId(),
        threadId: forkThreadId,
        sourceThreadId: threadId,
        projectId,
        title: "Visual",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        forkMessageId,
        createdAt: new Date().toISOString(),
      }),
    );
    const forkActivity = Option.getOrThrow(
      await runtime.runPromise(snapshots.getThreadDetailById(forkThreadId)),
    ).activities.find(
      (entry) => entry.kind === VISUAL_REPLY_ACTIVITY_KIND && Schema.is(VisualReply)(entry.payload),
    )!;
    const forkReply = Schema.decodeUnknownSync(VisualReply)(forkActivity.payload);
    expect(forkReply.threadId).toBe(forkThreadId);
    expect(await componentReplies(forkThreadId)).toMatchObject([
      { threadId: forkThreadId, blocks },
    ]);
    const forkBlob = Option.getOrThrow(
      await runtime.runPromise(
        attachments.findClaimedById({ attachmentId: forkReply.attachmentId }),
      ),
    );
    expect(forkBlob).toMatchObject({
      ownerThreadId: forkThreadId,
      claimMessageId: forkActivity.id,
      sha256: claimed.sha256,
    });
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.conversation.rollback.complete",
        commandId: commandId(),
        threadId,
        messageId: MessageId.makeUnsafe("visual-assistant"),
        numTurns: 1,
        removedTurnIds: [turnId],
        createdAt,
      }),
    );
    expect(
      Option.isNone(
        await runtime.runPromise(attachments.findClaimedById({ attachmentId: reply.attachmentId })),
      ),
    ).toBe(true);
    expect(
      Option.getOrThrow(
        await runtime.runPromise(snapshots.getThreadDetailById(threadId)),
      ).activities.some((entry) => entry.id === activity.id),
    ).toBe(false);
    expect(await componentReplies(threadId)).toEqual([]);
    expect(
      Option.isSome(
        await runtime.runPromise(
          attachments.findClaimedById({ attachmentId: forkReply.attachmentId }),
        ),
      ),
    ).toBe(true);
    expect(
      await fs.readFile(path.join(config.attachmentsDir, forkBlob.relativePath), "utf8"),
    ).toContain("Persisted chart");
  } finally {
    await runtime.dispose();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
