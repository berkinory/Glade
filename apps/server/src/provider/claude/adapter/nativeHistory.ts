import { Effect } from "effect";
import type { ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "../../core/Errors.ts";
import { readClaudeResumeState } from "./sessionResume.ts";
import { PROVIDER } from "./sessionTypes.ts";

export const updateClaudeNativeHistory: NonNullable<ClaudeAdapterShape["updateNativeHistory"]> = (
  input,
) =>
  Effect.gen(function* () {
    const sessionId = readClaudeResumeState(input.resumeCursor)?.resume;
    if (!sessionId)
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "updateNativeHistory",
        issue: "Claude history operation requires its persisted native session id.",
      });
    if (input.action.type !== "delete" && input.action.type !== "rename")
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "updateNativeHistory",
        issue: "Claude does not expose native session archiving.",
      });
    const action = input.action;
    yield* Effect.tryPromise({
      try: async () => {
        const sdk = await import("@anthropic-ai/claude-agent-sdk");
        if (action.type === "delete")
          await sdk.deleteSession(sessionId, input.cwd ? { dir: input.cwd } : {});
        else await sdk.renameSession(sessionId, action.title, input.cwd ? { dir: input.cwd } : {});
      },
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: action.type === "delete" ? "deleteSession" : "renameSession",
          detail: "Failed to update native Claude history.",
          cause,
        }),
    });
  });

export const readClaudeNativeTitle = (sessionId: string, cwd: string | undefined) =>
  Effect.tryPromise({
    try: async () => {
      const { getSessionInfo } = await import("@anthropic-ai/claude-agent-sdk");
      const info = await getSessionInfo(sessionId, cwd ? { dir: cwd } : {});
      return (info?.customTitle ?? info?.summary)?.trim() || undefined;
    },
    catch: (cause) =>
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "getSessionInfo",
        detail: "Failed to read native Claude title.",
        cause,
      }),
  });
