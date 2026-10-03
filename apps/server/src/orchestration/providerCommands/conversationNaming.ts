import type { ServiceMap } from "effect";
import { Duration, Effect, Option, Cause } from "effect";
import { WORKTREE_BRANCH_PREFIX, isTemporaryWorktreeBranch } from "@glade/shared/git/git";
import { AgentGatewayOperationRepository } from "../../agentGateway/Services/AgentGatewayOperationRepository.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  TextGeneration,
  type BranchNameGenerationInput,
} from "../../git/Services/TextGeneration.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { resolveTextGenerationInputForSelection } from "../../git/textGenerationSelection.ts";
import { providerStartOptionsFromServerSettings } from "../../settings/settingsPatches";
import { serverCommandId } from "./deliveryClaims";
import { type ChatAttachment } from "@glade/contracts/orchestration/threadEntities";

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
  readonly projectionAccess: ProviderProjectionAccessShape;
  readonly gatewayOperations: ServiceMap.Service.Shape<typeof AgentGatewayOperationRepository>;
  readonly serverSettings: ServiceMap.Service.Shape<typeof ServerSettingsService>;
  readonly git: ServiceMap.Service.Shape<typeof GitCore>;
  readonly orchestrationEngine: ServiceMap.Service.Shape<typeof OrchestrationEngineService>;
  readonly textGeneration: ServiceMap.Service.Shape<typeof TextGeneration>;
}) {
  const {
    gatewayOperations,
    serverSettings,
    git,
    orchestrationEngine,
    textGeneration,
    projectionAccess,
  } = input;
  const { resolveThread } = projectionAccess;
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
      ...(textGenerationInput.modelSelection
        ? { modelSelection: textGenerationInput.modelSelection }
        : {}),
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

  return { maybeGenerateAndRenameWorktreeBranchForFirstTurn };
}
