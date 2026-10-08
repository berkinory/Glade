import assert from "node:assert/strict";
import {
  type ApprovalRequestId,
  EventId,
  ThreadId,
  TurnId,
} from "@glade/contracts/core/baseSchemas";
import {
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
} from "@glade/contracts/provider/sessionPolicy";
import {
  type ProviderEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
} from "@glade/contracts/provider/provider";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { vi } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Stream } from "effect";

import {
  CodexAppServerManager,
  type CodexAppServerStartSessionInput,
  type CodexAppServerSendTurnInput,
} from "../codexAppServerManager.ts";
import { ServerConfig } from "../../../server/config.ts";
import { CodexAdapter } from "../../Services/CodexAdapter.ts";
import { ProviderSessionDirectory } from "../../Services/ProviderSessionDirectory.ts";
import { makeCodexAdapterLive } from "../../Layers/CodexAdapter.ts";

export class FakeCodexManager extends CodexAppServerManager {
  public startSessionImpl = vi.fn(
    async (input: CodexAppServerStartSessionInput): Promise<ProviderSession> => {
      const now = new Date().toISOString();
      return {
        provider: "codex",
        status: "ready",
        runtimeMode: input.runtimeMode,
        threadId: input.threadId,
        cwd: input.cwd,
        createdAt: now,
        updatedAt: now,
      };
    },
  );

  public sendTurnImpl = vi.fn(
    async (_input: CodexAppServerSendTurnInput): Promise<ProviderTurnStartResult> => ({
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: TurnId.makeUnsafe("turn-1"),
    }),
  );

  public steerTurnImpl = vi.fn(
    async (_input: CodexAppServerSendTurnInput): Promise<ProviderTurnStartResult> => ({
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: TurnId.makeUnsafe("turn-steer-1"),
    }),
  );

  override startSession(input: CodexAppServerStartSessionInput): Promise<ProviderSession> {
    return this.startSessionImpl(input);
  }

  override sendTurn(input: CodexAppServerSendTurnInput): Promise<ProviderTurnStartResult> {
    return this.sendTurnImpl(input);
  }

  override steerTurn(input: CodexAppServerSendTurnInput): Promise<ProviderTurnStartResult> {
    return this.steerTurnImpl(input);
  }

  override async interruptTurn(): Promise<void> {}

  override async readThread(_threadId: ThreadId) {
    return { threadId: ThreadId.makeUnsafe("thread-1"), turns: [] };
  }

  override async rollbackThread(): Promise<void> {}

  override async respondToRequest(
    _threadId: ThreadId,
    _requestId: ApprovalRequestId,
    _decision: ProviderApprovalDecision,
  ): Promise<void> {}

  override async respondToUserInput(
    _threadId: ThreadId,
    _requestId: ApprovalRequestId,
    _answers: ProviderUserInputAnswers,
  ): Promise<void> {}

  override async stopSession(_threadId: ThreadId): Promise<void> {}

  override listSessions(): ProviderSession[] {
    return [];
  }

  override hasSession(_threadId: ThreadId): boolean {
    return false;
  }

  override async stopAll(): Promise<void> {}
}

const providerSessionDirectoryTestLayer = Layer.succeed(ProviderSessionDirectory, {
  upsert: () => Effect.void,
  getProvider: () =>
    Effect.die(new Error("ProviderSessionDirectory.getProvider is not used in test")),
  getBinding: () => Effect.succeed(Option.none()),
  remove: () => Effect.void,
  listThreadIds: () => Effect.succeed([]),
  listBindings: () => Effect.succeed([]),
});

export const makeCodexAdapterTestLayer = (
  manager: FakeCodexManager,
  config = ServerConfig.layerTest(process.cwd(), process.cwd()),
) =>
  makeCodexAdapterLive({ manager }).pipe(
    Layer.provideMerge(config),
    Layer.provideMerge(providerSessionDirectoryTestLayer),
    Layer.provideMerge(NodeServices.layer),
  );

export const codexEvent = (
  id: string,
  event: Omit<ProviderEvent, "id" | "provider" | "createdAt" | "threadId"> & {
    readonly threadId?: ThreadId;
  },
): ProviderEvent => ({
  id: EventId.makeUnsafe(id),
  provider: "codex",
  createdAt: new Date().toISOString(),
  threadId: ThreadId.makeUnsafe("thread-1"),
  ...event,
});

// Missing runtime events surface through the suite's test timeout rather than a silent pass.
export const mapCodexEvents = (
  manager: FakeCodexManager,
  count: number,
  ...events: ReadonlyArray<ProviderEvent>
) =>
  Effect.gen(function* () {
    const adapter = yield* CodexAdapter;
    const collected = yield* Stream.runCollect(Stream.take(adapter.streamEvents, count)).pipe(
      Effect.forkChild,
    );
    for (const event of events) manager.emit("event", event);
    return Array.from(yield* Fiber.join(collected));
  });

export function eventOfType<T extends ProviderRuntimeEvent["type"]>(
  event: ProviderRuntimeEvent | undefined,
  type: T,
): Extract<ProviderRuntimeEvent, { readonly type: T }> {
  assert.equal(event?.type, type);
  return event as Extract<ProviderRuntimeEvent, { readonly type: T }>;
}

export const mapCodexEvent = <T extends ProviderRuntimeEvent["type"]>(
  manager: FakeCodexManager,
  type: T,
  event: ProviderEvent,
) => mapCodexEvents(manager, 1, event).pipe(Effect.map(([mapped]) => eventOfType(mapped, type)));
