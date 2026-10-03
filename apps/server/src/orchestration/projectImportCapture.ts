import { Effect } from "effect";
import { CommandId, type ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  ProjectImportHistoryRepository,
  StoredImportPage,
} from "../persistence/projectImportHistoryRepository";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine";
import { ProjectImportError, type ProjectImportHistoryPage } from "./projectImportHistory";

export const captureProjectImport = Effect.fn(function* <E>(input: {
  readonly threadId: ThreadId;
  readonly nativeId: string;
  readonly createdAt: string;
  readonly repository: ProjectImportHistoryRepository;
  readonly engine: OrchestrationEngineShape;
  readonly readPage: (cursor: string | null) => Effect.Effect<ProjectImportHistoryPage, E>;
}) {
  const { threadId, repository, engine } = input;
  yield* repository.initialize(threadId, input.nativeId);
  const identity = yield* repository.identity(threadId);
  if (!identity || identity.nativeId !== input.nativeId)
    return yield* new ProjectImportError({
      message: "The import copy changed or its destination was deleted. Refresh imports and retry.",
    });
  const stored = yield* repository.pages(threadId);
  const seenIds = new Set<string>();
  const seenMessages = new Set<string>();
  const seenCursors = new Set<string>();
  let bytes = 0;
  let cursor: string | null = null;
  for (let pageIndex = 0; pageIndex < 1000; pageIndex++) {
    let page: StoredImportPage | undefined = stored[pageIndex];
    if (!page) {
      const result: ProjectImportHistoryPage = yield* input.readPage(cursor);
      page = { ...result, pageIndex, cursor, applied: 0 };
    }
    const encodedBytes = Buffer.byteLength(JSON.stringify(page.messages), "utf8");
    if (
      page.cursor !== cursor ||
      (page.nextCursor !== null &&
        (page.sourceIds.length === 0 ||
          !page.nextCursor ||
          page.nextCursor === cursor ||
          seenCursors.has(page.nextCursor)))
    )
      return yield* new ProjectImportError({
        message:
          "The provider returned a nonadvancing history page. Update the provider and retry.",
      });
    if (
      page.sourceIds.length > 100 ||
      page.sourceIds.some((id) => !id || id.length > 512 || seenIds.has(id)) ||
      page.messages.some((message) => seenMessages.has(message.messageId)) ||
      new Set(page.messages.map((message) => message.messageId)).size !== page.messages.length ||
      new Set(page.sourceIds).size !== page.sourceIds.length
    )
      return yield* new ProjectImportError({
        message: "The provider repeated a history page. Retry after updating the provider.",
      });
    if (
      page.messages.length > 1000 ||
      encodedBytes > 2 * 1024 * 1024 ||
      bytes + encodedBytes > 64 * 1024 * 1024 ||
      page.messages.some(
        (message) => Buffer.byteLength(JSON.stringify(message), "utf8") > 64 * 1024,
      )
    )
      return yield* new ProjectImportError({
        message:
          "Imported history exceeds the display limit (64 KiB per message, 2 MiB per page, 64 MiB total). Reduce oversized source content and retry; the native source was not changed.",
      });
    bytes += encodedBytes;
    for (const id of page.sourceIds) seenIds.add(id);
    for (const message of page.messages) seenMessages.add(message.messageId);
    if (page.nextCursor !== null) seenCursors.add(page.nextCursor);
    // A crash after dispatch replays the frozen payload through the same durable command receipt.
    if (!stored[pageIndex]) yield* repository.save(threadId, page);
    if (!page.applied) {
      for (let offset = 0; offset < page.messages.length; offset += 100) {
        yield* engine.dispatch({
          type: "thread.messages.import",
          commandId: CommandId.makeUnsafe(
            `project-import:${threadId}:v${identity.revision}:page:${pageIndex}:${offset}`,
          ),
          threadId,
          messages: page.messages.slice(offset, offset + 100),
          createdAt: input.createdAt,
        });
      }
      yield* repository.applied(threadId, pageIndex);
    }
    cursor = page.nextCursor;
    if (cursor === null) return;
  }
  return yield* new ProjectImportError({
    message: "The conversation exceeds 1,000 import pages. Import a smaller source conversation.",
  });
});
