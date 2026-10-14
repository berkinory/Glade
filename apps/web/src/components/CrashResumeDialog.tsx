import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationCrashResumeOffer } from "@glade/contracts/orchestration/rpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { APP_DISPLAY_NAME } from "~/branding";
import { ensureNativeApi } from "~/nativeApi";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { toastManager } from "./ui/toast";

const CRASH_RESUME_OFFER_QUERY_KEY = ["orchestration", "crashResumeOffer"] as const;

const CONTINUATION_PROMPT = `${APP_DISPLAY_NAME} stopped unexpectedly while this chat was running, so the last run ended before it finished. Check the conversation and the current state of the workspace, and verify whether the last actions already took effect before repeating any of them. Then continue the unfinished task under its latest scope and constraints.`;

const EMPTY_OFFER: OrchestrationCrashResumeOffer = { chats: [] };

// The server records the chats an unexpected shutdown cut off; nothing continues until the person
// chooses to here, and either answer settles the offer for every window.
export function CrashResumeDialog() {
  const queryClient = useQueryClient();
  const offer = useQuery({
    queryKey: CRASH_RESUME_OFFER_QUERY_KEY,
    queryFn: () => ensureNativeApi().orchestration.getCrashResumeOffer(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [skippedIds, setSkippedIds] = useState<ReadonlySet<string>>(() => new Set());
  const resolve = useMutation({
    mutationFn: (continueThreadIds: ReadonlyArray<string>) =>
      ensureNativeApi().orchestration.resolveCrashResume({
        continueThreadIds: continueThreadIds.map((threadId) => ThreadId.makeUnsafe(threadId)),
        continuationPrompt: CONTINUATION_PROMPT,
      }),
    onSuccess: (result, continueThreadIds) => {
      queryClient.setQueryData(CRASH_RESUME_OFFER_QUERY_KEY, EMPTY_OFFER);
      if (result.continuedThreadIds.length < continueThreadIds.length) {
        toastManager.add({
          type: "info",
          title: "Some chats were not continued",
          description: "They had already moved on since the shutdown.",
        });
      }
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not continue the chats",
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const chats = offer.data?.chats ?? [];
  if (chats.length === 0) return null;
  const selectedIds = chats
    .map((chat) => chat.threadId)
    .filter((threadId) => !skippedIds.has(threadId));
  const single = chats.length === 1;
  const toggle = (threadId: string, selected: boolean) =>
    setSkippedIds((current) => {
      const next = new Set(current);
      if (selected) next.delete(threadId);
      else next.add(threadId);
      return next;
    });

  return (
    <AlertDialog
      open={!resolve.isSuccess}
      onOpenChange={(open) => {
        if (!open && !resolve.isPending) resolve.mutate([]);
      }}
    >
      <AlertDialogPopup className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{APP_DISPLAY_NAME} stopped unexpectedly</AlertDialogTitle>
          <AlertDialogDescription>
            {single
              ? "This chat was still running. Continuing sends it a message asking the agent to check what already happened before carrying on."
              : "These chats were still running. Continuing sends each selected chat a message asking the agent to check what already happened before carrying on."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="m-0 flex max-h-[40vh] list-none flex-col gap-2 overflow-y-auto px-4 pb-2">
          {chats.map((chat) => (
            <li key={chat.threadId} className="flex min-w-0 items-center gap-2.5 text-ui">
              {single ? null : (
                <Checkbox
                  aria-label={`Continue ${chat.title}`}
                  checked={!skippedIds.has(chat.threadId)}
                  disabled={resolve.isPending}
                  onCheckedChange={(checked) => toggle(chat.threadId, checked === true)}
                />
              )}
              <span className="truncate">{chat.title}</span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogClose
            disabled={resolve.isPending}
            render={<Button variant="outline" size="sm" />}
          >
            Dismiss
          </AlertDialogClose>
          <Button
            size="sm"
            disabled={resolve.isPending || selectedIds.length === 0}
            onClick={() => resolve.mutate(selectedIds)}
          >
            {single || selectedIds.length === chats.length ? "Continue" : "Continue selected"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
