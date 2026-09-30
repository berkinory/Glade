import type { ClaudeSessionRegistryShape } from "../../Services/ClaudeSessionRegistry.ts";
import { makeKeyedLock } from "../../core/keyedLock.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { PROVIDER } from "./sessionTypes";
import { type ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import { Effect } from "effect";
import { ClaudeAdapterLiveOptions } from "./adapterConfiguration";
import type { ClaudeRuntimeEventsShape } from "../../Services/ClaudeRuntimeEvents.ts";
import { ProviderAdapterValidationError, ProviderAdapterRequestError } from "../../core/Errors.ts";
import { loadClaudeAgentSdk } from "../claudeAgentSdk.ts";
import { readClaudeSessionParentUuid } from "../claudeProjectImport.ts";
import { toRequestError, toMessage } from "./streamErrors";
import { readClaudeResumeState } from "./sessionResume";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { restoreClaudeImportedCopyDates } from "../claudeImportedCopyDates.ts";
import type {
  ClaudeSessionAccessShape,
  ClaudeStartPreflight,
} from "../../Services/ClaudeSessionAccess.ts";
import { makeClaudeSessionTeardown } from "./sessionTeardown";

export function makeClaudeSessionBranching(input: {
  readonly withSessionLifecycleLock: ReturnType<typeof makeKeyedLock<ThreadId>>["withLock"];
  readonly sessions: ClaudeSessionRegistryShape;
  readonly resolveClaudeStartPreflight: ClaudeSessionAccessShape["resolveClaudeStartPreflight"];
  readonly assertSessionReplaceable: ClaudeSessionAccessShape["assertSessionReplaceable"];
  readonly stopSessionInternal: ReturnType<typeof makeClaudeSessionTeardown>["stopSessionInternal"];
  readonly startSessionUnlocked: (
    input: Parameters<ClaudeAdapterShape["startSession"]>[0],
    preflight?: ClaudeStartPreflight,
  ) => ReturnType<ClaudeAdapterShape["startSession"]>;
  readonly requireSession: ClaudeSessionAccessShape["requireSession"];
  readonly options: ClaudeAdapterLiveOptions | undefined;
  readonly forkNativeSession: (
    sessionId: string,
    forkOptions?: { readonly dir?: string; readonly upToMessageId?: string },
  ) => Promise<{ sessionId: string }>;
  readonly snapshotThread: ClaudeRuntimeEventsShape["snapshotThread"];
}) {
  const {
    withSessionLifecycleLock,
    sessions,
    resolveClaudeStartPreflight,
    assertSessionReplaceable,
    stopSessionInternal,
    startSessionUnlocked,
    requireSession,
    options,
    forkNativeSession,
    snapshotThread,
  } = input;
  const rollbackThread: ClaudeAdapterShape["rollbackThread"] = (threadId, numTurns) =>
    withSessionLifecycleLock(
      threadId,
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (context.turnState || context.pendingDispatches) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "Cannot rollback while an active turn is in progress.",
          });
        }
        if (!Number.isInteger(numTurns) || numTurns < 1 || !context.resumeSessionId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "The requested Claude edit boundary is invalid.",
          });
        }
        const sourceSessionId = context.resumeSessionId;
        const resumeCursor = yield* Effect.tryPromise({
          try: async () => {
            const readMessages =
              options?.readNativeSessionMessages ?? (await loadClaudeAgentSdk()).getSessionMessages;
            const messages = await readMessages(
              sourceSessionId,
              context.session.cwd ? { dir: context.session.cwd } : {},
            );

            const prompts = messages.filter((entry) => {
              if (entry.type !== "user" || entry.parent_tool_use_id !== null) return false;
              const message = entry.message as { content?: unknown } | null;
              const content = message?.content;
              return (
                typeof content === "string" ||
                (Array.isArray(content) &&
                  content.length > 0 &&
                  !content.some((block) => block?.type === "tool_result"))
              );
            });
            const target = prompts[prompts.length - numTurns];
            if (!target)
              throw new Error("The edited prompt is missing from the native Claude history.");
            const parent = await (options?.readNativeMessageParent ?? readClaudeSessionParentUuid)({
              sessionId: sourceSessionId,
              messageId: target.uuid,
            });

            const forked =
              parent === null
                ? undefined
                : await forkNativeSession(sourceSessionId, {
                    ...(context.session.cwd ? { dir: context.session.cwd } : {}),
                    upToMessageId: parent,
                  });
            return {
              threadId,
              ...(forked ? { resume: forked.sessionId } : {}),
              turnCount: prompts.length - numTurns,
            };
          },
          catch: (cause) => toRequestError(threadId, "session/rollback", cause),
        });
        const startInput = {
          ...context.startInput,
          ...(context.session.model
            ? {
                modelSelection: {
                  ...(context.startInput.modelSelection?.provider === PROVIDER
                    ? context.startInput.modelSelection
                    : {}),
                  provider: PROVIDER,
                  model: context.session.model,
                },
              }
            : {}),
          resumeCursor,
          forkSourceResumeCursor: undefined,
        };
        const preflight = yield* resolveClaudeStartPreflight(startInput);
        yield* stopSessionInternal(context, { emitExitEvent: false });
        yield* startSessionUnlocked(startInput, preflight);
        return yield* snapshotThread(yield* requireSession(threadId));
      }),
    );

  const forkThread: NonNullable<ClaudeAdapterShape["forkThread"]> = (input) =>
    Effect.gen(function* () {
      const liveSource = sessions.get(input.sourceThreadId);

      if (liveSource?.turnState !== undefined) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "forkThread",
          issue:
            "The source Claude session has a turn in flight; wait for it to finish before forking.",
        });
      }
      const sourceState = readClaudeResumeState(input.sourceResumeCursor);
      const sourceSessionId = liveSource?.resumeSessionId ?? sourceState?.resume;
      if (!sourceSessionId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "forkThread",
          issue: "The source Claude session has no resumable native cursor.",
        });
      }
      if (input.forkPoint && input.forkPoint.provider !== "claudeAgent") {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "forkThread",
          issue: "Invalid Claude fork point provider.",
        });
      }
      let upToMessageId =
        input.forkPoint?.provider === "claudeAgent"
          ? input.forkPoint.messageId
          : (liveSource?.lastAssistantUuid ?? sourceState?.resumeSessionAt);
      const sourceCwd = liveSource?.session.cwd ?? input.sourceCwd;
      let importedSourceMessages: ReadonlyArray<SessionMessage> | undefined;
      if (input.requireCompletedSource) {
        const messages = yield* Effect.tryPromise({
          try: async () => {
            const readMessages =
              options?.readNativeSessionMessages ?? (await loadClaudeAgentSdk()).getSessionMessages;
            return readMessages(sourceSessionId, sourceCwd ? { dir: sourceCwd } : {});
          },
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/read",
              detail: toMessage(cause, "Failed to read the source Claude transcript."),
              cause,
            }),
        });
        const lastMessage = messages.at(-1);
        const message = lastMessage?.message;
        const stopReason =
          message && typeof message === "object" && "stop_reason" in message
            ? message.stop_reason
            : undefined;
        const content =
          message && typeof message === "object" && "content" in message
            ? message.content
            : undefined;
        const legacyTextOnly =
          stopReason === undefined &&
          ((typeof content === "string" && content.trim().length > 0) ||
            (Array.isArray(content) &&
              content.length > 0 &&
              content.every((block) => block?.type === "text")));
        const hasPendingToolUse =
          Array.isArray(content) && content.some((block) => block?.type === "tool_use");

        if (
          lastMessage?.type !== "assistant" ||
          hasPendingToolUse ||
          (!legacyTextOnly &&
            stopReason !== "end_turn" &&
            stopReason !== "stop_sequence" &&
            stopReason !== "max_tokens")
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "forkThread",
            issue:
              "Wait for the source Claude conversation to finish its turn before importing it.",
          });
        }
        // Freeze the boundary before the SDK copies the file: new messages appended concurrently by Claude
        // must not enter the imported copy.
        upToMessageId ??= lastMessage.uuid;
        importedSourceMessages = messages;
      }
      const forked = yield* Effect.tryPromise({
        try: () =>
          forkNativeSession(sourceSessionId, {
            ...(sourceCwd ? { dir: sourceCwd } : {}),
            ...(upToMessageId ? { upToMessageId } : {}),
          }),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/fork",
            detail: toMessage(cause, "Failed to fork the Claude session transcript."),
            cause,
          }),
      });
      if (importedSourceMessages !== undefined) {
        yield* Effect.tryPromise({
          try: () =>
            restoreClaudeImportedCopyDates({
              sourceSessionId,
              copiedSessionId: forked.sessionId,
              sourceMessages: importedSourceMessages!,
            }),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/fork",
              detail: toMessage(cause, "Failed to preserve the imported conversation dates."),
              cause,
            }),
        });
      }
      // The SDK fork remaps every message uuid, so the source's resume pin (`resumeSessionAt`) and
      // tracked tasks must not carry into the fork. A live context restarts `turns` at [] on resume, so
      // its length can undercount the cumulative persisted total — keep the larger of the two.
      const resumeCursor = {
        threadId: input.threadId,
        resume: forked.sessionId,
        turnCount: Math.max(liveSource?.turns.length ?? 0, sourceState?.turnCount ?? 0),
        processedTokenTotal: 0,
        tokenAccountingVersion: 1,
      };
      return { threadId: input.threadId, resumeCursor };
    });

  const prepareSessionReplacement: NonNullable<ClaudeAdapterShape["prepareSessionReplacement"]> = (
    input,
  ) =>
    withSessionLifecycleLock(
      input.threadId,
      Effect.gen(function* () {
        const context = sessions.get(input.threadId);
        if (!context) return undefined;
        const preflight = yield* resolveClaudeStartPreflight(input).pipe(
          Effect.mapError(
            (error) =>
              new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "session/reconfigure",
                issue: error.issue,
              }),
          ),
        );

        yield* assertSessionReplaceable(input.threadId);
        const session = context.session;

        yield* stopSessionInternal(context, { emitExitEvent: false });
        return {
          previousSession: session,
          startSession: (startInput) =>
            withSessionLifecycleLock(
              startInput.threadId,
              startSessionUnlocked(startInput, preflight),
            ),
        };
      }),
    );
  return { prepareSessionReplacement, rollbackThread, forkThread };
}
