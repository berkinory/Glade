import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { GitStatusResult } from "@glade/contracts/git/git";
import { mergeGitStatusParts } from "@glade/shared/git/git";

import { ensureNativeApi } from "../nativeApi";
import { gitQueryKeys } from "../lib/gitQueryOptions";

export function useGitStatusPush() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const subscriptions = new Map<string, () => void>();
    const reconcile = () => {
      const active = new Set(
        queryClient
          .getQueryCache()
          .findAll({ queryKey: gitQueryKeys.statuses })
          .flatMap((query) =>
            query.isActive() && typeof query.queryKey[2] === "string" ? [query.queryKey[2]] : [],
          ),
      );
      for (const [cwd, unsubscribe] of subscriptions) {
        if (!active.has(cwd)) {
          unsubscribe();
          subscriptions.delete(cwd);
        }
      }
      for (const cwd of active) {
        if (subscriptions.has(cwd)) continue;
        subscriptions.set(
          cwd,
          ensureNativeApi().git.onStatus({ cwd }, (event) => {
            if (event._tag === "summaryUpdated") return;
            queryClient.setQueryData<GitStatusResult>(gitQueryKeys.status(cwd), (current) => {
              if (event._tag === "snapshot") return mergeGitStatusParts(event.local, event.remote);
              if (!current) return current;
              if (event._tag === "localUpdated") return { ...current, ...event.local };
              return mergeGitStatusParts(current, event.remote);
            });
            if (event._tag !== "localUpdated") return;
            for (const queryKey of [
              gitQueryKeys.branches(cwd),
              gitQueryKeys.workingTreeDiffs(cwd),
              gitQueryKeys.sourceControlFiles(cwd),
            ])
              void queryClient.invalidateQueries({ queryKey });
          }),
        );
      }
    };
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        ["observerAdded", "observerRemoved", "observerOptionsUpdated", "removed"].includes(
          event.type,
        )
      )
        reconcile();
    });
    reconcile();
    return () => {
      unsubscribe();
      subscriptions.forEach((stop) => stop());
    };
  }, [queryClient]);
}
