import type { ServiceMap } from "effect";
import { Duration, Deferred, Effect, Option, Cause } from "effect";
import { WORKTREE_BRANCH_PREFIX, isTemporaryWorktreeBranch } from "@glade/shared/git/git";
import { AgentGatewayOperationRepository } from "../../agentGateway/Services/AgentGatewayOperationRepository.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { makeProviderProjectionAccess } from "./projectionAccess";
import {
  type ModelSelection,
  type ProviderStartOptions,
} from "@glade/contracts/provider/sessionPolicy";
import { ProviderHealth } from "../../provider/Services/ProviderHealth.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  TextGeneration,
  type BranchNameGenerationInput,
  type ThreadTitleGenerationInput,
} from "../../git/Services/TextGeneration.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationRegenerateThreadTitleResult } from "@glade/contracts/orchestration/rpc";
import type { TaggedFailure } from "../../platform/operationError.ts";
import { resolveTextGenerationInputForSelection } from "../../git/textGenerationSelection.ts";
import { providerStartOptionsFromServerSettings } from "../../settings/settingsPatches";
import { serverCommandId } from "./deliveryClaims";
import { type ChatAttachment } from "@glade/contracts/orchestration/threadEntities";
import {
  buildPromptThreadTitleFallback,
  isGenericChatThreadTitle,
  buildThreadTitleConversationContext,
  isUsableGeneratedThreadTitle,
} from "@glade/shared/threads/chatThreads";
import { attachmentTitleSeed } from "./inputProjection";
import { type ProviderCommandReactorShape } from "../Services/ProviderCommandReactor.ts";
import { ProviderCommandExecutionError } from "./providerCallPolicy";
import { TextGenerationError } from "../../git/Errors.ts";

const GATEWAY_OPERATION_COMPLETION_WAIT_TIMEOUT = Duration.seconds(120);

function buildGeneratedWorktreeBranchName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "")
    .replace(/['"`]/g, "");

  const withoutPrefix = normalized.replace(/^glade\//, "");

  const branchFragment = withoutPrefix
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  const safeFragment = branchFragment.length > 0 ? branchFragment : "update";
  return `${WORKTREE_BRANCH_PREFIX}/${safeFragment}`;
}

export function makeProviderConversationNaming(input: {
  readonly gatewayOperations: ServiceMap.Service.Shape<typeof AgentGatewayOperationRepository>;
  readonly serverSettings: ServiceMap.Service.Shape<typeof ServerSettingsService>;
  readonly resolveThread: ReturnType<typeof makeProviderProjectionAccess>["resolveThread"];
  readonly threadSessionModelSelections: Map<string, ModelSelection>;
  readonly threadProviderOptions: Map<string, ProviderStartOptions>;
  readonly providerHealth: ServiceMap.Service.Shape<typeof ProviderHealth>;
  readonly git: ServiceMap.Service.Shape<typeof GitCore>;
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
  readonly textGeneration: ServiceMap.Service.Shape<typeof TextGeneration>;
  readonly resolveProjectedThreadWorkspaceCwd: ReturnType<
    typeof makeProviderProjectionAccess
  >["resolveProjectedThreadWorkspaceCwd"];
  readonly pendingTitleGenerations: Map<
    ThreadId,
    Deferred.Deferred<OrchestrationRegenerateThreadTitleResult, TaggedFailure>
  >;
}) {
  const {
    gatewayOperations,
    serverSettings,
    resolveThread,
    threadSessionModelSelections,
    threadProviderOptions,
    providerHealth,
    git,
    orchestrationEngine,
    textGeneration,
    resolveProjectedThreadWorkspaceCwd,
    pendingTitleGenerations,
  } = input;
  const waitForGatewayOperationCompletion = Effect.fnUntraced(function* (operationId: string) {
    const completed = yield* Effect.gen(function* () {
      while (true) {
        const operation = yield* gatewayOperations
          .getById(operationId)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning(
                "provider command reactor could not read creating gateway operation; skipping worktree branch rename",
                { operationId, error: error instanceof Error ? error.message : String(error) },
              ).pipe(Effect.as(null)),
            ),
          );
        if (operation === null) {
          return false;
        }
        if (operation.status === "completed") {
          return true;
        }
        if (operation.status === "failed" || operation.status === "compensating") {
          return false;
        }
        yield* Effect.sleep(Duration.millis(100));
      }
    }).pipe(Effect.timeoutOption(GATEWAY_OPERATION_COMPLETION_WAIT_TIMEOUT));
    if (Option.isNone(completed)) {
      yield* Effect.logWarning(
        "provider command reactor timed out waiting for creating gateway operation; skipping worktree branch rename",
        { operationId },
      );
      return false;
    }
    return completed.value;
  });

  const resolveConfiguredTextGenerationInput = Effect.fnUntraced(function* () {
    const settings = yield* serverSettings.getSettings;
    return resolveTextGenerationInputForSelection(
      settings.textGenerationModelSelection,
      providerStartOptionsFromServerSettings(settings),
    );
  });

  const resolveThreadTextGenerationInput = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly modelSelection?: ModelSelection;
    readonly providerOptions?: ProviderStartOptions;
    readonly useConfiguredFallback?: boolean;
  }) {
    const thread = yield* resolveThread(input.threadId);
    const modelSelection =
      input.modelSelection ??
      thread?.modelSelection ??
      threadSessionModelSelections.get(input.threadId);
    const providerOptions = input.providerOptions ?? threadProviderOptions.get(input.threadId);
    const threadTextGenerationInput = resolveTextGenerationInputForSelection(
      modelSelection,
      providerOptions,
    );

    if (threadTextGenerationInput || !input.useConfiguredFallback) {
      return threadTextGenerationInput;
    }

    const settings = yield* serverSettings.getSettings;
    const statuses = yield* providerHealth.getStatuses;
    const fallbackStatus = statuses.find(
      (status) => status.provider === settings.textGenerationModelSelection.provider,
    );
    if (fallbackStatus && !fallbackStatus.available) {
      return null;
    }
    return yield* resolveConfiguredTextGenerationInput();
  });

  const renameTemporaryWorktreeBranch = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly oldBranch: string;
    readonly targetBranch: string;
    readonly gatewayOperationId: string | null;
  }) {
    if (input.targetBranch === input.oldBranch) {
      return;
    }

    if (input.gatewayOperationId !== null) {
      const completed = yield* waitForGatewayOperationCompletion(input.gatewayOperationId);
      if (!completed) {
        return;
      }
    }

    const renamed = yield* git.withMutation(
      input.cwd,
      Effect.gen(function* () {
        const result = yield* git.renameBranch({
          cwd: input.cwd,
          oldBranch: input.oldBranch,
          newBranch: input.targetBranch,
        });
        yield* git.publishBranch({ cwd: input.cwd, branch: result.branch }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("provider command reactor failed to publish renamed branch", {
              threadId: input.threadId,
              cwd: input.cwd,
              branch: result.branch,
              cause: Cause.pretty(cause),
            }),
          ),
        );
        return result;
      }),
    );
    yield* orchestrationEngine.dispatch({
      type: "thread.meta.update",
      commandId: serverCommandId("worktree-branch-rename"),
      threadId: input.threadId,
      branch: renamed.branch,
      worktreePath: input.cwd,
      associatedWorktreePath: input.cwd,
      associatedWorktreeBranch: renamed.branch,
      associatedWorktreeRef: renamed.branch,
    });
  });

  const resolveFirstTurnThread = Effect.fnUntraced(function* (
    threadId: ThreadId,
    messageId: string,
  ) {
    const thread = yield* resolveThread(threadId);
    if (!thread) return null;
    const userMessages = thread.messages.filter(
      (message) =>
        message.role === "user" &&
        (message.source === "native" || message.source === "async-user-input"),
    );
    return userMessages.length === 1 && userMessages[0]?.id === messageId ? thread : null;
  });

  const maybeGenerateAndRenameWorktreeBranchForFirstTurn = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly messageId: string;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
  }) {
    if (!input.branch || !input.worktreePath) {
      return;
    }
    if (!isTemporaryWorktreeBranch(input.branch)) {
      return;
    }

    const thread = yield* resolveFirstTurnThread(input.threadId, input.messageId);
    if (!thread) return;

    const oldBranch = input.branch;
    const cwd = input.worktreePath;
    const attachments = input.attachments ?? [];

    const textGenerationInput = yield* resolveConfiguredTextGenerationInput();
    if (!textGenerationInput) {
      yield* Effect.logDebug(
        "provider command reactor has no Git-writing model for worktree branch naming; keeping temporary branch",
        {
          threadId: input.threadId,
          cwd,
          branch: oldBranch,
        },
      );
      return;
    }
    const branchNameGenerationInput: BranchNameGenerationInput = {
      cwd,
      message: input.messageText,
      ...(attachments.length > 0 ? { attachments } : {}),
      modelSelection: textGenerationInput.modelSelection,
      ...(textGenerationInput.providerOptions
        ? { providerOptions: textGenerationInput.providerOptions }
        : {}),
    };
    yield* textGeneration.generateBranchName(branchNameGenerationInput).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          "provider command reactor failed to generate worktree branch name; keeping temporary branch",
          { threadId: input.threadId, cwd, oldBranch, reason: error.message },
        ),
      ),
      Effect.flatMap((generated) => {
        if (!generated) return Effect.void;

        const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);
        return renameTemporaryWorktreeBranch({
          threadId: input.threadId,
          cwd,
          oldBranch,
          targetBranch,
          gatewayOperationId: thread.gatewayOperationId ?? null,
        });
      }),
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to generate or rename worktree branch", {
          threadId: input.threadId,
          cwd,
          oldBranch,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const maybeGenerateAndRenameThreadTitleForFirstTurn = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly messageId: string;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
    readonly modelSelection?: ModelSelection;
    readonly providerOptions?: ProviderStartOptions;
  }) {
    const expectedTitleSequence = yield* orchestrationEngine.getThreadTitleHighWaterSequence(
      input.threadId,
    );
    const thread = yield* resolveFirstTurnThread(input.threadId, input.messageId);
    if (!thread) return;

    const fallbackTitle = buildPromptThreadTitleFallback(
      input.messageText.trim() || attachmentTitleSeed(input.attachments?.[0]) || "",
    );
    const currentTitle = thread.title.trim();
    if (!isGenericChatThreadTitle(currentTitle) && currentTitle !== fallbackTitle) {
      return;
    }
    const cwd = yield* resolveProjectedThreadWorkspaceCwd(thread);
    const textGenerationInput = yield* resolveThreadTextGenerationInput({
      threadId: input.threadId,
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      useConfiguredFallback: true,
    });
    if (!textGenerationInput) {
      if (fallbackTitle !== currentTitle) {
        yield* orchestrationEngine
          .dispatch({
            type: "thread.meta.update",
            commandId: serverCommandId("thread-title-fallback-rename"),
            threadId: input.threadId,
            title: fallbackTitle,
            expectedTitleSequence,
          })
          .pipe(Effect.catchTag("OrchestrationCommandInvariantError", () => Effect.void));
      }
      return;
    }
    const textGenerationSelection = textGenerationInput.modelSelection;
    const textGenerationLogContext = {
      threadId: input.threadId,
      cwd,
      threadProvider: thread.modelSelection.provider,
      threadModel: thread.modelSelection.model,
      requestedProvider: input.modelSelection?.provider ?? null,
      requestedModel: input.modelSelection?.model ?? null,
      textGenerationProvider: textGenerationSelection.provider,
      textGenerationModel: textGenerationSelection.model,
      textGenerationOptions: textGenerationSelection.options ?? null,
    };
    yield* Effect.logDebug("provider command reactor generating thread title", {
      ...textGenerationLogContext,
      hasProviderOptions: Boolean(textGenerationInput.providerOptions),
    });
    const titleGenerationInput: ThreadTitleGenerationInput = {
      cwd: cwd ?? process.cwd(),
      message: input.messageText,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      modelSelection: textGenerationInput.modelSelection,
      ...(textGenerationInput.providerOptions
        ? { providerOptions: textGenerationInput.providerOptions }
        : {}),
    };
    const nextTitle = yield* textGeneration.generateThreadTitle(titleGenerationInput).pipe(
      Effect.map((generated) => generated.title),
      Effect.catch((error) =>
        Effect.logWarning("provider command reactor failed to generate thread title", {
          ...textGenerationLogContext,
          reason: error.message,
        }).pipe(Effect.as(fallbackTitle)),
      ),
    );

    if (nextTitle === currentTitle) {
      return;
    }

    yield* orchestrationEngine
      .dispatch({
        type: "thread.meta.update",
        commandId: serverCommandId("thread-title-rename"),
        threadId: input.threadId,
        title: nextTitle,
        expectedTitleSequence,
      })
      .pipe(Effect.catchTag("OrchestrationCommandInvariantError", () => Effect.void));
  });

  const generateConversationTitle: ProviderCommandReactorShape["regenerateThreadTitle"] = (input) =>
    Effect.gen(function* () {
      const expectedTitleSequence = yield* orchestrationEngine.getThreadTitleHighWaterSequence(
        input.threadId,
      );
      const thread = yield* resolveThread(input.threadId);
      if (!thread || thread.deletedAt != null || thread.archivedAt != null) {
        return yield* Effect.fail(new ProviderCommandExecutionError("Thread is unavailable."));
      }
      const context = buildThreadTitleConversationContext(thread.messages);
      if (!context) {
        return { status: "no-context", title: null };
      }

      const expectedTitle =
        (yield* orchestrationEngine.getReadModel()).threads.find(
          (candidate) => candidate.id === input.threadId,
        )?.title ?? thread.title;
      const cwd = yield* resolveProjectedThreadWorkspaceCwd(thread);
      const settings = yield* serverSettings.getSettings;
      const textGenerationInput = yield* resolveThreadTextGenerationInput({
        threadId: input.threadId,
        providerOptions: providerStartOptionsFromServerSettings(settings),
        useConfiguredFallback: true,
      });
      if (!textGenerationInput) {
        return yield* new TextGenerationError({
          operation: "generateThreadTitle",
          detail: "No enabled text-generation provider is available for this thread.",
        });
      }

      const generated = yield* textGeneration.generateThreadTitle({
        cwd: cwd ?? process.cwd(),
        message: context,
        context: "conversation",
        modelSelection: textGenerationInput.modelSelection,
        ...(textGenerationInput.providerOptions
          ? { providerOptions: textGenerationInput.providerOptions }
          : {}),
      });
      if (!isUsableGeneratedThreadTitle(generated.title)) {
        return yield* new TextGenerationError({
          operation: "generateThreadTitle",
          detail: "The generated thread title was empty or generic.",
        });
      }
      if (generated.title === expectedTitle) {
        const currentTitleSequence = yield* orchestrationEngine.getThreadTitleHighWaterSequence(
          input.threadId,
        );
        const currentThread = (yield* orchestrationEngine.getReadModel()).threads.find(
          (candidate) => candidate.id === input.threadId,
        );
        const titleIsCurrent =
          currentTitleSequence === expectedTitleSequence && currentThread?.title === expectedTitle;
        return titleIsCurrent
          ? { status: "unchanged", title: expectedTitle }
          : { status: "stale", title: null };
      }

      const updated = yield* orchestrationEngine
        .dispatch({
          type: "thread.meta.update",
          commandId: serverCommandId("thread-title-regenerate"),
          threadId: input.threadId,
          title: generated.title,
          expectedTitleSequence,
        })
        .pipe(
          Effect.as(true),
          Effect.catch((error) => {
            if (
              error._tag === "OrchestrationCommandInvariantError" &&
              error.commandType === "thread.meta.update"
            ) {
              return Effect.succeed(false);
            }
            return Effect.fail(error);
          }),
        );
      return updated
        ? { status: "renamed", title: generated.title }
        : { status: "stale", title: null };
    });

  const regenerateThreadTitle: ProviderCommandReactorShape["regenerateThreadTitle"] = (input) =>
    Effect.suspend(() => {
      const pending = pendingTitleGenerations.get(input.threadId);
      if (pending) return Deferred.await(pending);
      const result = Deferred.makeUnsafe<OrchestrationRegenerateThreadTitleResult, TaggedFailure>();
      pendingTitleGenerations.set(input.threadId, result);
      return generateConversationTitle(input).pipe(
        Effect.onExit((exit) => Deferred.done(result, exit)),
        Effect.ensuring(Effect.sync(() => pendingTitleGenerations.delete(input.threadId))),
      );
    });
  return {
    maybeGenerateAndRenameWorktreeBranchForFirstTurn,
    maybeGenerateAndRenameThreadTitleForFirstTurn,
    regenerateThreadTitle,
  };
}
