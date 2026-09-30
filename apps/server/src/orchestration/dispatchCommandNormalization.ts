import type {
  ClientOrchestrationCommand,
  OrchestrationCommand,
} from "@glade/contracts/orchestration/commands";
import { isWorkspaceRootWithin, workspaceRootsEqual } from "@glade/shared/threads/threadWorkspace";
import type { FileSystem, Path } from "effect";
import { Effect, Schedule } from "effect";

import { createAttachmentId } from "../attachments/attachmentStore";

class AttachmentNormalizationError extends Error {
  readonly _tag = "AttachmentNormalizationError";
}

export interface DispatchCommandNormalizerOptions<E> {
  readonly attachmentsDir: string;
  readonly chatWorkspaceRoot?: string;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly canonicalizeProjectWorkspaceRoot: (
    workspaceRoot: string,
    options?: { readonly createIfMissing?: boolean },
  ) => Effect.Effect<string, E>;
  readonly prepareChatWorkspaceRoot?: (workspaceRoot: string) => Effect.Effect<void, E>;
}

// Since this runs AFTER the orchestration decider has already accepted the dispatch (see wsRpc), a
// single transient failure here would otherwise permanently strand the project row without its
// managed subdirectories.
const WORKSPACE_ROOT_PREPARE_RETRY_SCHEDULE = Schedule.exponential("100 millis").pipe(
  Schedule.take(2),
);

export function makeDispatchCommandNormalizer<E>(options: DispatchCommandNormalizerOptions<E>) {
  const deferredPrepareWorkspaceRoot = (
    command: Extract<
      ClientOrchestrationCommand,
      { type: "project.create" | "project.meta.update" }
    >,
    workspaceRoot: string,
  ): Effect.Effect<void, E> => {
    if (
      command.kind !== "chat" ||
      command.createWorkspaceRootIfMissing !== true ||
      !options.chatWorkspaceRoot ||
      !options.prepareChatWorkspaceRoot
    ) {
      return Effect.void;
    }
    if (
      !isWorkspaceRootWithin(workspaceRoot, options.chatWorkspaceRoot) ||
      workspaceRootsEqual(workspaceRoot, options.chatWorkspaceRoot)
    ) {
      return Effect.void;
    }
    return options
      .prepareChatWorkspaceRoot(workspaceRoot)
      .pipe(Effect.retry(WORKSPACE_ROOT_PREPARE_RETRY_SCHEDULE));
  };

  return Effect.fnUntraced(function* (input: { readonly command: ClientOrchestrationCommand }) {
    if (input.command.type === "project.create") {
      const workspaceRoot = yield* options.canonicalizeProjectWorkspaceRoot(
        input.command.workspaceRoot,
        {
          createIfMissing: input.command.createWorkspaceRootIfMissing === true,
        },
      );
      const command = {
        ...input.command,
        workspaceRoot,
        createWorkspaceRootIfMissing: input.command.createWorkspaceRootIfMissing === true,
      } satisfies OrchestrationCommand;
      return {
        command,
        prepareWorkspaceRoot: deferredPrepareWorkspaceRoot(input.command, workspaceRoot),
      };
    }

    if (input.command.type === "project.meta.update" && input.command.workspaceRoot !== undefined) {
      const workspaceRoot = yield* options.canonicalizeProjectWorkspaceRoot(
        input.command.workspaceRoot,
        {
          createIfMissing: input.command.createWorkspaceRootIfMissing === true,
        },
      );
      const command = {
        ...input.command,
        workspaceRoot,
        createWorkspaceRootIfMissing: input.command.createWorkspaceRootIfMissing === true,
      } satisfies OrchestrationCommand;
      return {
        command,
        prepareWorkspaceRoot: deferredPrepareWorkspaceRoot(input.command, workspaceRoot),
      };
    }

    if (input.command.type !== "thread.turn.start") {
      return {
        command: input.command as OrchestrationCommand,
        prepareWorkspaceRoot: null,
      };
    }
    const turnStartCommand = input.command;

    const normalizedAttachments = yield* Effect.forEach(
      turnStartCommand.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          if (attachment.type === "assistant-selection") {
            const attachmentId = createAttachmentId(turnStartCommand.threadId);
            if (!attachmentId) {
              return yield* Effect.fail(
                new AttachmentNormalizationError("Failed to create a safe attachment id."),
              );
            }

            return {
              type: "assistant-selection" as const,
              id: attachmentId,
              assistantMessageId: attachment.assistantMessageId,
              text: attachment.text,
            };
          }

          return attachment;
        }),
      { concurrency: 1 },
    );

    return {
      command: {
        ...turnStartCommand,
        message: {
          ...turnStartCommand.message,
          attachments: normalizedAttachments,
        },
      } satisfies OrchestrationCommand,
      prepareWorkspaceRoot: null,
    };
  });
}
