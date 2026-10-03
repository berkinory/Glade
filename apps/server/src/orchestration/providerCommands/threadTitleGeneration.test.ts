import { makeThreadTitleGeneration } from "./threadTitleGeneration";
import { describe, expect, it } from "vitest";
import { Deferred, Effect } from "effect";
import { CommandId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { makeReactorTestHarness, asMessageId, waitFor } from "./reactorTestFixtures";
import { applyNativeThreadTitle } from "../runtimeActivities/nativeThreadTitles";

const threadId = ThreadId.makeUnsafe("thread-1");

describe("conversation title ownership", () => {
  const { createHarness, readHarnessThread } = makeReactorTestHarness();

  it("defers short messages and reserves one generation across repeated delivery", async () => {
    const harness = await createHarness();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("short-title"),
        threadId,
        title: "hi",
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.messages.import",
        commandId: CommandId.makeUnsafe("short-history"),
        threadId,
        messages: [
          {
            messageId: asMessageId("short"),
            role: "user",
            text: "hi",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
      }),
    );
    const generate = makeThreadTitleGeneration({
      engine: harness.engine,
      projection: {
        resolveThread: (id) =>
          harness.engine
            .getReadModel()
            .pipe(Effect.map((model) => model.threads.find((thread) => thread.id === id))),
      },
      generator: { generate: harness.generateTitle },
    });
    await Effect.runPromise(
      generate({
        threadId,
        messageId: asMessageId("short"),
        message: "hi",
        modelSelection: { provider: "codex", model: "gpt-6-luna" },
      }),
    );
    expect(harness.generateTitle).not.toHaveBeenCalled();
    const command = {
      type: "thread.turn.start" as const,
      commandId: CommandId.makeUnsafe("title-turn"),
      threadId,
      message: {
        messageId: asMessageId("meaningful"),
        role: "user" as const,
        text: "Fix the sidebar hover",
        attachments: [],
      },
      runtimeMode: "approval-required" as const,
      createdAt: new Date().toISOString(),
    };
    await Effect.runPromise(harness.engine.dispatch(command));
    await waitFor(
      async () => (await readHarnessThread(harness))?.title === "Generated conversation title",
    );
    await Effect.runPromise(harness.engine.dispatch(command));
    await harness.drain();
    await Effect.runPromise(
      generate({
        threadId,
        messageId: asMessageId("meaningful"),
        message: "Fix the sidebar hover",
        modelSelection: { provider: "codex", model: "gpt-6-luna" },
      }),
    );
    expect(harness.generateTitle).toHaveBeenCalledOnce();
    expect(harness.generateTitle.mock.calls[0]?.[0].message).toBe("Fix the sidebar hover");
    await Effect.runPromise(
      applyNativeThreadTitle({
        threadId,
        title: "Native title",
        commandId: CommandId.makeUnsafe("native-title"),
        engine: harness.engine,
        provider: { updateNativeHistory: () => Effect.void },
      }),
    );
    expect((await readHarnessThread(harness))?.title).toBe("Generated conversation title");
  });

  it("keeps a manual rename while a background title request completes", async () => {
    const harness = await createHarness({ updateNativeHistory: () => Effect.void });
    const completion = await Effect.runPromise(Deferred.make<string>());
    harness.generateTitle.mockImplementation(() => Deferred.await(completion));
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("generic"),
        threadId,
        title: "New thread",
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("rename-race-turn"),
        threadId,
        message: {
          messageId: asMessageId("rename-race"),
          role: "user",
          text: "Fix the authentication flow",
          attachments: [],
        },
        runtimeMode: "approval-required",
        createdAt: new Date().toISOString(),
      }),
    );
    await waitFor(
      () =>
        harness.generateTitle.mock.calls.length === 1 && harness.sendTurn.mock.calls.length === 1,
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("manual"),
        threadId,
        title: "My chosen title",
        titleSource: "user",
      }),
    );
    for (const [title, id] of [
      ["My chosen title", "native-rename-echo"],
      ["Late native title", "late-native-title"],
    ]) {
      await Effect.runPromise(
        applyNativeThreadTitle({
          threadId,
          title: title!,
          commandId: CommandId.makeUnsafe(id!),
          engine: harness.engine,
          provider: { updateNativeHistory: () => Effect.void },
        }),
      );
    }
    expect((await readHarnessThread(harness))?.title).toBe("My chosen title");
    await Effect.runPromise(Deferred.succeed(completion, "Automatic title"));
    await harness.drain();
    expect((await readHarnessThread(harness))?.title).toBe("My chosen title");
  });
});
