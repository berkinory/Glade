import { ThreadId } from "@glade/contracts/core/baseSchemas";

import { APP_DISPLAY_NAME } from "~/branding";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";

import {
  quitResumeContinuationPrompt,
  stopRunningChatsForQuit,
  type RunningChatQuitSummary,
  type StopRunningChatsForQuitResult,
} from "./runningChatsQuitConfirmation";

// Stops this machine's running chats before its server goes down; with resume, the server records
// them so they continue once it starts again.
export function stopLocalRunningChats(
  chats: ReadonlyArray<RunningChatQuitSummary>,
  resume: boolean,
): Promise<StopRunningChatsForQuitResult> {
  return stopRunningChatsForQuit({
    chats,
    dispatchInterrupt: (threadId) =>
      readNativeApi()?.orchestration.dispatchCommand({
        type: "thread.turn.interrupt",
        commandId: newCommandId(),
        threadId: ThreadId.makeUnsafe(threadId),
        createdAt: new Date().toISOString(),
      }),
    ...(resume
      ? {
          resume: {
            prepare: (threadIds: ReadonlyArray<string>) => {
              const api = readNativeApi();
              if (!api) {
                return Promise.reject(new Error("Native API unavailable"));
              }
              return api.orchestration.prepareQuitResume({
                threadIds: threadIds.map((threadId) => ThreadId.makeUnsafe(threadId)),
                continuationPrompt: quitResumeContinuationPrompt(APP_DISPLAY_NAME),
              });
            },
          },
        }
      : {}),
  });
}
