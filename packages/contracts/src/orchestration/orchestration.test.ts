import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  ClientOrchestrationCommand,
  OrchestrationCommand,
  ProjectCreateCommand,
  ThreadTurnStartCommand,
} from "./commands";
import { DEFAULT_RUNTIME_MODE } from "../provider/sessionPolicy";
import { OrchestrationGetTurnDiffInput } from "./rpc";
import { OrchestrationReadModel } from "./snapshots";
import { ProjectCreatedPayload, ThreadMetaUpdatedPayload, ThreadCreatedPayload } from "./events";
import {
  OrchestrationSession,
  OrchestrationThreadPullRequest,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  THREAD_NOTES_MAX_CHARS,
  ThreadTurnDiff,
} from "./threadEntities";

const decodeTurnDiffInput = Schema.decodeUnknownEffect(OrchestrationGetTurnDiffInput);
const decodeThreadTurnDiff = Schema.decodeUnknownEffect(ThreadTurnDiff);
const decodeProjectCreateCommand = Schema.decodeUnknownEffect(ProjectCreateCommand);
const decodeProjectCreatedPayload = Schema.decodeUnknownEffect(ProjectCreatedPayload);
const decodeThreadTurnStartCommand = Schema.decodeUnknownEffect(ThreadTurnStartCommand);

const decodeOrchestrationSession = Schema.decodeUnknownEffect(OrchestrationSession);
const decodeThreadCreatedPayload = Schema.decodeUnknownEffect(ThreadCreatedPayload);
const decodeThreadMetaUpdatedPayload = Schema.decodeUnknownEffect(ThreadMetaUpdatedPayload);
const decodeClientOrchestrationCommand = Schema.decodeUnknownEffect(ClientOrchestrationCommand);
const decodeOrchestrationCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const decodeThreadPullRequest = Schema.decodeUnknownEffect(OrchestrationThreadPullRequest);

it.effect("decodes last-known PRs persisted before draft/mergeability/diff fields existed", () =>
  Effect.gen(function* () {
    const legacy = yield* decodeThreadPullRequest({
      number: 42,
      title: "Legacy PR",
      url: "https://github.com/o/r/pull/42",
      baseBranch: "main",
      headBranch: "feature/legacy",
      state: "open",
    });
    assert.equal(legacy.number, 42);
    assert.equal(legacy.isDraft, undefined);
    assert.equal(legacy.mergeability, undefined);

    const enriched = yield* decodeThreadPullRequest({
      number: 43,
      title: "Enriched PR",
      url: "https://github.com/o/r/pull/43",
      baseBranch: "main",
      headBranch: "feature/enriched",
      state: "open",
      isDraft: true,
      mergeability: "conflicting",
      additions: 38,
      deletions: 36,
      changedFiles: 3,
    });
    assert.equal(enriched.isDraft, true);
    assert.equal(enriched.mergeability, "conflicting");
    assert.equal(enriched.additions, 38);
  }),
);

it.effect("preserves thread activity payloads through the RPC JSON codec", () =>
  Effect.gen(function* () {
    const codec = Schema.toCodecJson(OrchestrationReadModel);
    const readModel = {
      snapshotSequence: 1,
      spaces: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      projects: [],
      threads: [
        {
          id: "thread-1",
          codexThreadId: null,
          projectId: "project-1",
          title: "Thread 1",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.5",
          },

          runtimeMode: "full-access",
          envMode: "local",
          branch: null,
          worktreePath: null,
          associatedWorktreePath: null,
          associatedWorktreeBranch: null,
          associatedWorktreeRef: null,
          createBranchFlowCompleted: false,
          parentThreadId: null,
          subagentAgentId: null,
          subagentNickname: null,
          subagentRole: null,
          forkSourceThreadId: null,
          lastKnownPr: null,
          handoff: null,
          latestTurn: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [],

          activities: [
            {
              id: "activity-1",
              tone: "tool",
              kind: "tool.completed",
              summary: "Ran command",
              payload: {
                itemType: "command_execution",
                data: {
                  item: {
                    command: "git status --short",
                  },
                },
              },
              turnId: null,
              sequence: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          checkpoints: [],
          session: null,
        },
      ],
    };

    const encoded = yield* Schema.encodeUnknownEffect(codec)(readModel);
    const decoded = yield* Schema.decodeUnknownEffect(codec)(encoded);
    const activity = decoded.threads[0]?.activities[0];

    assert.deepStrictEqual(activity?.payload, {
      itemType: "command_execution",
      data: {
        item: {
          command: "git status --short",
        },
      },
    });
  }),
);

it.effect.each([
  ["turn diff input", decodeTurnDiffInput],
  ["thread turn diff", decodeThreadTurnDiff],
] as const)("rejects %s when fromTurnCount > toTurnCount", ([, decode]) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode({ threadId: "thread-1", fromTurnCount: 3, toTurnCount: 2, diff: "patch" }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("keeps generic conversation rollback internal-only", () =>
  Effect.gen(function* () {
    const rollbackCommand = {
      type: "thread.conversation.rollback",
      commandId: "cmd-rollback",
      threadId: "thread-1",
      messageId: "message-1",
      numTurns: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    const clientResult = yield* Effect.exit(decodeClientOrchestrationCommand(rollbackCommand));
    assert.strictEqual(clientResult._tag, "Failure");

    const parsedInternal = yield* decodeOrchestrationCommand(rollbackCommand);
    assert.strictEqual(parsedInternal.type, "thread.conversation.rollback");
  }),
);

it.effect("trims branded ids and command string fields at decode boundaries", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: " cmd-1 ",
      projectId: " project-1 ",
      title: " Project Title ",
      workspaceRoot: " /tmp/workspace ",
      defaultModelSelection: {
        provider: "codex",
        model: " gpt-5.2 ",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.commandId, "cmd-1");
    assert.strictEqual(parsed.projectId, "project-1");
    assert.strictEqual(parsed.title, "Project Title");
    assert.strictEqual(parsed.workspaceRoot, "/tmp/workspace");
    assert.deepStrictEqual(parsed.defaultModelSelection, {
      provider: "codex",
      model: "gpt-5.2",
    });
  }),
);

it.effect("defaults isPinned for historical project.created payloads", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.isPinned, false);
  }),
);

it.effect("rejects command fields that become empty after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeProjectCreateCommand({
        type: "project.create",
        commandId: "cmd-1",
        projectId: "project-1",
        title: "  ",
        workspaceRoot: "/tmp/workspace",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes thread.turn.start defaults for provider, runtime mode, and dispatch mode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-1",
      threadId: "thread-1",
      message: {
        messageId: "msg-1",
        role: "user",
        text: "hello",
        attachments: [],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection, undefined);
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);

    assert.strictEqual(parsed.dispatchMode, "queue");
  }),
);

it.effect("bounds initial turn text while preserving attachment-only turns", () =>
  Effect.gen(function* () {
    const command = (text: string, attachments: ReadonlyArray<unknown> = []) => ({
      type: "thread.turn.start",
      commandId: "cmd-turn-input-limit",
      threadId: "thread-1",
      message: { messageId: "msg-input-limit", role: "user", text, attachments },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const exact = yield* decodeThreadTurnStartCommand(
      command("x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
    );
    assert.strictEqual(exact.message.text.length, PROVIDER_SEND_TURN_MAX_INPUT_CHARS);

    const overLimit = yield* Effect.exit(
      decodeThreadTurnStartCommand(command("x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1))),
    );
    assert.strictEqual(overLimit._tag, "Failure");

    const whitespaceOnly = yield* Effect.exit(decodeThreadTurnStartCommand(command("   ")));
    assert.strictEqual(whitespaceOnly._tag, "Failure");

    const attachmentOnly = yield* decodeThreadTurnStartCommand(
      command("", [
        {
          type: "image",
          id: "thread-1-11111111-1111-4111-8111-111111111111",
          name: "screen.png",
          mimeType: "image/png",
          sizeBytes: 1,
        },
      ]),
    );
    assert.strictEqual(attachmentOnly.message.attachments.length, 1);
  }),
);

it.effect("decodes thread.created runtime mode for historical events", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Thread title",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },

      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.modelSelection.provider, "codex");
  }),
);

it.effect("strips client-sent dispatchOrigin from thread.turn.start commands", () =>
  Effect.gen(function* () {
    // dispatchOrigin is server-assigned. The client command schema
    // deliberately omits it, so a spoofed value must not survive decoding — otherwise any WS client
    // could fake the server-assigned message origin.
    const command = yield* decodeClientOrchestrationCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-start-origin",
      threadId: "thread-1",
      message: {
        messageId: "message-1",
        role: "user",
        text: "hello",
        attachments: [],
      },
      dispatchMode: "queue",
      dispatchOrigin: "agent",
      runtimeMode: "full-access",

      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(command.type, "thread.turn.start");
    assert.strictEqual("dispatchOrigin" in command, false);
  }),
);

it.effect("rejects oversized thread notes payloads", () =>
  Effect.gen(function* () {
    const failed = yield* decodeThreadMetaUpdatedPayload({
      threadId: "thread-1",
      notes: "x".repeat(THREAD_NOTES_MAX_CHARS + 1),
      updatedAt: "2026-01-01T00:00:00.000Z",
    }).pipe(
      Effect.match({
        onFailure: () => true,
        onSuccess: () => false,
      }),
    );
    assert.strictEqual(failed, true);
  }),
);

it.effect.each([
  ["normalized", decodeThreadTurnStartCommand, (index: number) => `attachment-${index}`],
  [
    "client",
    decodeClientOrchestrationCommand,
    (index: number) => `thread-1-00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  ],
] as const)("rejects %s thread.turn.start commands with too many attachments", ([, decode, id]) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode({
        type: "thread.turn.start",
        commandId: "cmd-turn-too-many-attachments",
        threadId: "thread-1",
        message: {
          messageId: "msg-too-many-attachments",
          role: "user",
          text: "hello",
          attachments: Array.from(
            { length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS + 1 },
            (_, index) => ({
              type: "image",
              id: id(index),
              name: `image-${index}.png`,
              mimeType: "image/png",
              sizeBytes: 1,
            }),
          ),
        },
        runtimeMode: "full-access",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes orchestration session runtime mode defaults", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSession({
      threadId: "thread-1",
      status: "idle",
      providerName: null,
      providerSessionId: null,
      providerThreadId: null,
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
  }),
);

it.effect("preserves user-input answer values through the RPC JSON codec", () =>
  Effect.gen(function* () {
    const codec = Schema.toCodecJson(ClientOrchestrationCommand);
    const wire = {
      type: "thread.user-input.respond",
      commandId: "cmd-1",
      threadId: "thread-1",
      requestId: "req-1",
      answers: {
        single: "Purple",
        multi: ["Reading", "Coding"],
        skipped: null,
      },
      createdAt: "2026-05-19T16:14:28.202Z",
    };
    const decoded = yield* Schema.decodeUnknownEffect(codec)(wire);
    assert.deepStrictEqual(
      (decoded as Extract<typeof decoded, { type: "thread.user-input.respond" }>).answers,
      {
        single: "Purple",
        multi: ["Reading", "Coding"],
        skipped: null,
      },
    );
  }),
);
