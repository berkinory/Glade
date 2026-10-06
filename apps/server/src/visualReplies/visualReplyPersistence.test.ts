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

it("publishes owned HTML atomically, retains it through replay and prunes it with its turn", async () => {
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
    const render = makeVisualReplyTools({ preview, snapshots, engine, attachments, config }).find(
      (tool) => tool.definition.name === "html_render",
    )!;
    const result = await runtime.runPromise(
      render.handler(
        {
          title: "Chart",
          html: '<h1>Persisted chart</h1><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="20"/></svg>',
        },
        context,
      ),
    );
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const model = await runtime.runPromise(engine.getReadModel());
    const activity = model.threads[0]!.activities.find(
      (entry) => entry.kind === VISUAL_REPLY_ACTIVITY_KIND,
    )!;
    const reply = Schema.decodeUnknownSync(VisualReply)(activity.payload);
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
  } finally {
    await runtime.dispose();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
