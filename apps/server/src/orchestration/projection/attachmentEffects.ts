import { type ProjectionThreadMessage } from "../../persistence/Services/ProjectionThreadMessages.ts";
import {
  toSafeThreadAttachmentSegment,
  attachmentRelativePath,
  parseThreadSegmentFromAttachmentId,
  parseAttachmentIdFromRelativePath,
} from "../../attachments/attachmentStore.ts";
import { Effect, FileSystem, Path } from "effect";
import { ServerConfig } from "../../server/config.ts";
import { AttachmentSideEffects } from "./projectorRegistration";

export function collectThreadAttachmentRelativePaths(
  threadId: string,
  messages: ReadonlyArray<ProjectionThreadMessage>,
): Set<string> {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  const relativePaths = new Set<string>();
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.type !== "image" && attachment.type !== "file") {
        continue;
      }
      if (attachment.id.startsWith("att_v2_")) {
        relativePaths.add(attachmentRelativePath(attachment));
        continue;
      }
      if (!threadSegment) {
        continue;
      }
      if (parseThreadSegmentFromAttachmentId(attachment.id) !== threadSegment) {
        continue;
      }
      relativePaths.add(attachmentRelativePath(attachment));
    }
  }
  return relativePaths;
}

export const runAttachmentSideEffects = Effect.fn(function* (sideEffects: AttachmentSideEffects) {
  if (sideEffects.deletedThreadIds.size === 0 && sideEffects.prunedThreadRelativePaths.size === 0) {
    return;
  }
  const serverConfig = yield* Effect.service(ServerConfig);
  const fileSystem = yield* Effect.service(FileSystem.FileSystem);
  const path = yield* Effect.service(Path.Path);

  const attachmentsRootDir = serverConfig.attachmentsDir;
  const attachmentRootEntries = yield* fileSystem
    .readDirectory(attachmentsRootDir, { recursive: false })
    .pipe(Effect.catch(() => Effect.succeed([] as Array<string>)));

  const resolveThreadAttachmentEntry = (threadSegment: string, entry: string) => {
    const relativePath = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    if (relativePath.length === 0 || relativePath.includes("/")) return undefined;
    const attachmentId = parseAttachmentIdFromRelativePath(relativePath);
    if (!attachmentId) return undefined;
    return parseThreadSegmentFromAttachmentId(attachmentId) === threadSegment
      ? relativePath
      : undefined;
  };

  yield* Effect.forEach(sideEffects.deletedThreadIds, (threadId) =>
    Effect.gen(function* () {
      const threadSegment = toSafeThreadAttachmentSegment(threadId);
      if (!threadSegment) {
        yield* Effect.logWarning("skipping attachment cleanup for unsafe thread id", {
          threadId,
        });
        return;
      }

      yield* Effect.forEach(attachmentRootEntries, (entry) => {
        const relativePath = resolveThreadAttachmentEntry(threadSegment, entry);
        return relativePath
          ? fileSystem.remove(path.join(attachmentsRootDir, relativePath), { force: true })
          : Effect.void;
      });
    }),
  );

  yield* Effect.forEach(
    sideEffects.prunedThreadRelativePaths.entries(),
    ([threadId, keptThreadRelativePaths]) => {
      if (sideEffects.deletedThreadIds.has(threadId)) {
        return Effect.void;
      }
      return Effect.gen(function* () {
        const threadSegment = toSafeThreadAttachmentSegment(threadId);
        if (!threadSegment) {
          yield* Effect.logWarning("skipping attachment prune for unsafe thread id", { threadId });
          return;
        }
        yield* Effect.forEach(attachmentRootEntries, (entry) =>
          Effect.gen(function* () {
            const relativePath = resolveThreadAttachmentEntry(threadSegment, entry);
            if (!relativePath) return;

            const absolutePath = path.join(attachmentsRootDir, relativePath);
            const fileInfo = yield* fileSystem
              .stat(absolutePath)
              .pipe(Effect.catch(() => Effect.succeed(null)));
            if (!fileInfo || fileInfo.type !== "File") return;

            if (!keptThreadRelativePaths.has(relativePath)) {
              yield* fileSystem.remove(absolutePath, { force: true });
            }
          }),
        );
      });
    },
  );
});
