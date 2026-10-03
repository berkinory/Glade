import { Effect } from "effect";
import { CommandId, type MessageId, type ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ThreadTitleGenerationInput } from "../Services/ThreadTitleGeneration";
import type { ThreadTitleGenerationShape } from "../Services/ThreadTitleGeneration";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine";
import type { ProviderProjectionAccessShape } from "../Services/ProviderProjectionAccess";
import { readThreadTitleIntent } from "../runtimeActivities/nativeThreadTitles";
import {
  buildPromptThreadTitleFallback,
  isGenericChatThreadTitle,
} from "@glade/shared/threads/chatThreads";
import { isMeaningfulTitleMessage } from "../threadTitlePrompt";

interface AutoThreadTitleInput extends ThreadTitleGenerationInput {
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
}

export type MaybeGenerateThreadTitle = (input: AutoThreadTitleInput) => Effect.Effect<void>;

export function makeThreadTitleGeneration(input: {
  readonly engine: OrchestrationEngineShape;
  readonly projection: Pick<ProviderProjectionAccessShape, "resolveThread">;
  readonly generator: ThreadTitleGenerationShape;
}): MaybeGenerateThreadTitle {
  return (request) =>
    Effect.gen(function* () {
      if (!isMeaningfulTitleMessage(request.message)) return;
      const intent = yield* readThreadTitleIntent(input.engine, request.threadId);
      if (
        intent.userTitle !== undefined ||
        intent.titleSource === "auto" ||
        intent.titleSource === "provider"
      )
        return;
      const thread = yield* input.projection.resolveThread(request.threadId);
      if (!thread) return;
      const messages = thread.messages.filter(
        (message) =>
          message.role === "user" &&
          (message.source === "native" || message.source === "async-user-input"),
      );
      const firstMeaningful = messages.find((message) => isMeaningfulTitleMessage(message.text));
      if (firstMeaningful?.id !== request.messageId) return;
      if (
        !isGenericChatThreadTitle(thread.title) &&
        !messages.some((message) => buildPromptThreadTitleFallback(message.text) === thread.title)
      )
        return;
      // Reserve ownership durably before calling the provider, including across restart or duplicate delivery.
      const reservation = yield* input.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe(`server:title-reserve:${request.messageId}`),
        threadId: request.threadId,
        title: buildPromptThreadTitleFallback(request.message),
        titleSource: "auto",
        expectedTitleSequence: intent.sequence,
      });
      const title = yield* input.generator.generate(request);
      yield* input.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe(`server:title-generated:${request.messageId}`),
        threadId: request.threadId,
        title,
        titleSource: "auto",
        expectedTitleSequence: reservation.sequence,
      });
    }).pipe(
      Effect.catchTag("OrchestrationCommandInvariantError", () => Effect.void),
      Effect.catch((error) =>
        Effect.logWarning("Conversation title generation failed", {
          threadId: request.threadId,
          error: error.message,
        }),
      ),
    );
}
