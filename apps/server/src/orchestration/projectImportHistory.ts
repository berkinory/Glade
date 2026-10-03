import { stat } from "node:fs/promises";
import type { ProjectImportProvider } from "@glade/contracts/workspace/projectImport";
import type { ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";
import type { ThreadHandoffImportedMessage } from "@glade/contracts/orchestration/commands";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderAdapterError, ProviderUnsupportedError } from "../provider/core/Errors.ts";
import { Data, Effect } from "effect";
import { loadClaudeAgentSdk } from "../provider/claude/claudeAgentSdk";
import {
  findClaudeSessionTranscriptPath,
  readClaudeImportMessageDates,
} from "../provider/claude/claudeProjectImport";
import type { ProviderAdapterRegistryShape } from "../provider/Services/ProviderAdapterRegistry";
import { mapClaudeSessionMessages, mapCodexSnapshotMessages } from "./importedThreadMessages";

export class ProjectImportError extends Data.TaggedError("ProjectImportError")<{
  readonly message: string;
}> {}

export const projectImportPromise = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new ProjectImportError({ message: cause instanceof Error ? cause.message : String(cause) }),
  });

export function nativeImportId(provider: ProjectImportProvider, cursor: unknown): string | null {
  if (!cursor || typeof cursor !== "object") return null;
  const value =
    provider === "codex"
      ? (cursor as { threadId?: unknown }).threadId
      : (cursor as { resume?: unknown }).resume;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export interface ReadProjectImportHistoryInput {
  readonly cursor: string | null;
  readonly provider: ProjectImportProvider;
  readonly threadId: ThreadId;
  readonly nativeId: string;
  readonly sourceHome: string;
  readonly sourceCwd: string;
  readonly sourceCreatedAt: string;
  readonly providerOptions?: ProviderStartOptions;
  readonly cwd?: string;
}

export interface ProjectImportHistoryPage {
  readonly messages: ReadonlyArray<ThreadHandoffImportedMessage>;
  readonly nextCursor: string | null;
  readonly sourceIds: ReadonlyArray<string>;
}

export function makeProjectImportHistoryReader(registry: ProviderAdapterRegistryShape) {
  return Effect.fn(function* (
    input: ReadProjectImportHistoryInput,
  ): Effect.fn.Return<
    ProjectImportHistoryPage,
    ProjectImportError | ProviderAdapterError | ProviderUnsupportedError
  > {
    if (input.provider === "claudeAgent") {
      const offset = input.cursor === null ? 0 : Number(input.cursor);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000)
        return yield* new ProjectImportError({ message: "Invalid Claude history page offset." });
      return yield* projectImportPromise(async () => {
        const file = await findClaudeSessionTranscriptPath({
          sessionId: input.nativeId,
          configDir: input.sourceHome,
        });
        if (!file)
          throw new Error(
            "The copied Claude archive is unavailable. Restore the configured source home and retry.",
          );
        if ((await stat(file)).size > 128 * 1024 * 1024)
          throw new Error(
            "The Claude archive exceeds the supported 128 MiB import size. Import a smaller conversation.",
          );
        const sdk = await loadClaudeAgentSdk();
        const history = await sdk.getSessionMessages(input.nativeId, {
          dir: input.sourceCwd,
          limit: 100,
          offset,
        });
        if (history.length > 100 || history.some((message) => !message.uuid))
          throw new Error("Claude returned an invalid history page. Update the configured SDK.");
        if (Buffer.byteLength(JSON.stringify(history), "utf8") > 8 * 1024 * 1024)
          throw new Error(
            "A Claude history page exceeds 8 MiB. Reduce oversized source output before importing.",
          );
        const dates = await readClaudeImportMessageDates({
          sessionId: input.nativeId,
          configDir: input.sourceHome,
          messageIds: new Set(history.map((message) => message.uuid)),
        });
        return {
          messages: mapClaudeSessionMessages({
            threadId: input.threadId,
            importedAt: input.sourceCreatedAt,
            messages: history.map((message) => ({
              ...message,
              timestamp: dates.get(message.uuid),
            })),
          }),
          nextCursor: history.length === 100 ? String(offset + 100) : null,
          sourceIds: history.map((message) => message.uuid),
        };
      });
    }
    const adapter = yield* registry.getByProvider("codex");
    if (!adapter.readExternalThreadPage)
      return yield* new ProjectImportError({
        message: "Codex history paging is unavailable. Update the configured CLI.",
      });
    const page = yield* adapter.readExternalThreadPage({
      externalThreadId: input.nativeId,
      cursor: input.cursor,
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
    });
    return {
      messages: mapCodexSnapshotMessages({
        threadId: input.threadId,
        importedAt: input.sourceCreatedAt,
        turns: page.turns,
      }),
      sourceIds: page.turns.map((turn) => turn.id),
      nextCursor: page.nextCursor,
    };
  });
}
