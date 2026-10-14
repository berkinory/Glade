import { cleanChatImageSnapshots } from "../../attachments/chatImages/cleanup";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CommandId, EventId, MessageId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import { Option } from "effect";
import { expect, it } from "vitest";
import {
  createOrchestrationSystem,
  now,
  seedProjectAndThread,
} from "../testing/orchestrationEngineSystem";

it("preserves completed images when their source is overwritten and reuses identical content", async () => {
  const system = await createOrchestrationSystem();
  const directory = await mkdtemp(path.join(os.tmpdir(), "glade-image-history-"));
  const source = path.join(directory, "preview.svg");
  const before = '<svg xmlns="http://www.w3.org/2000/svg"><text>before</text></svg>';
  const after = before.replace("before", "after");
  const threadId = ThreadId.makeUnsafe("image-history");
  const createdAt = now();
  let sequence = 0;
  const commandId = () => CommandId.makeUnsafe(`image-history-${++sequence}`);
  const complete = async (id: string) => {
    const messageId = MessageId.makeUnsafe(id);
    await system.run(
      system.engine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: commandId(),
        threadId,
        messageId,
        turnId: TurnId.makeUnsafe(`turn-${id}`),
        delta: `![preview](<${source}>)`,
        createdAt,
      }),
    );
    await system.run(
      system.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: commandId(),
        threadId,
        messageId,
        createdAt,
      }),
    );
    const thread = Option.getOrThrow(
      await system.run(system.snapshotQuery.getThreadDetailById(threadId)),
    );
    return thread.messages.find((message) => message.id === messageId)!.text;
  };
  try {
    await seedProjectAndThread(system, { projectId: "image-project", threadId, createdAt });
    await writeFile(source, before);
    const first = await complete("first");
    expect(first).toContain("/attachments/chat-images/");
    expect(await complete("same-content")).toBe(first);
    await system.run(
      system.engine.dispatch({
        type: "thread.activity.append",
        createdAt,
        commandId: commandId(),
        threadId,
        activity: {
          id: EventId.makeUnsafe("view-image"),
          tone: "tool",
          kind: "tool.completed",
          summary: "Image view",
          createdAt,
          turnId: null,
          payload: { itemType: "image_view", data: { item: { id: "view-call", path: source } } },
        },
      }),
    );
    const viewed = Option.getOrThrow(
      await system.run(system.snapshotQuery.getThreadDetailById(threadId)),
    ).activities.find((activity) => activity.id === "view-image");
    const imageUrl = first.match(/<([^>]+)>/)![1]!;
    expect(viewed?.payload).toMatchObject({
      imageSnapshotUrl: imageUrl,
      data: { item: { id: "view-call", path: source } },
    });
    await writeFile(source, after);
    await system.run(
      system.engine.dispatch({
        type: "thread.activity.append",
        commandId: commandId(),
        threadId,
        createdAt,
        activity: {
          id: EventId.makeUnsafe("view-image-replay"),
          tone: "tool",
          kind: "tool.completed",
          summary: "Image view",
          createdAt,
          turnId: null,
          payload: { itemType: "image_view", data: { item: { id: "view-call", path: source } } },
        },
      }),
    );
    const replay = Option.getOrThrow(
      await system.run(system.snapshotQuery.getThreadDetailById(threadId)),
    ).activities.find((activity) => activity.id === "view-image-replay");
    expect(replay?.payload).toMatchObject({ imageSnapshotUrl: imageUrl });
    const second = await complete("second");
    expect(second).not.toBe(first);
    const thread = Option.getOrThrow(
      await system.run(system.snapshotQuery.getThreadDetailById(threadId)),
    );
    expect(thread.messages.find((message) => message.id === "first")!.text).toBe(first);
    const imagePath = first.match(/\/attachments\/(chat-images\/[^>]+)>/)![1]!;
    expect(await readFile(path.join(system.config.attachmentsDir, imagePath), "utf8")).toBe(before);
    await rm(source);
    const unavailable = await complete("unavailable");
    expect(unavailable).toContain("image could not be preserved");
    expect(unavailable).not.toContain("![");
    const forkId = ThreadId.makeUnsafe("image-fork");
    await system.run(
      system.engine.dispatch({
        type: "thread.fork.create",
        commandId: commandId(),
        threadId: forkId,
        sourceThreadId: threadId,
        projectId: thread.projectId,
        title: "Image fork",
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        envMode: "local",
        branch: null,
        worktreePath: null,
        createBranchFlowCompleted: false,
        forkMessageId: MessageId.makeUnsafe("first"),
        createdAt,
      }),
    );
    await system.run(
      system.engine.dispatch({ type: "thread.delete", commandId: commandId(), threadId }),
    );
    const cleanup = () =>
      system.run(
        cleanChatImageSnapshots({
          sql: system.sql,
          attachmentsDir: system.config.attachmentsDir,
          now: new Date(Date.now() + 2 * 60 * 60 * 1000),
        }),
      );
    await cleanup();
    expect(await readFile(path.join(system.config.attachmentsDir, imagePath), "utf8")).toBe(before);
    await system.run(
      system.engine.dispatch({ type: "thread.delete", commandId: commandId(), threadId: forkId }),
    );
    await cleanup();
    await expect(
      readFile(path.join(system.config.attachmentsDir, imagePath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await system.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
