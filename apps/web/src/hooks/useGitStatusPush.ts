import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { GitStatusResult } from "@glade/contracts/git/git";
import { mergeGitStatusParts } from "@glade/shared/git/git";

import { ensureNativeApi } from "../nativeApi";
import { activeGitStatusCwds, gitQueryKeys } from "../lib/gitQueryOptions";

export function useGitStatusPush() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refreshes = new Map<
      string,
      { running: boolean; pending: Set<string>; timer: ReturnType<typeof setTimeout> | null }
    >();
    let disposed = false;
    const schedule = (cwd: string, kinds: readonly string[]) => {
      let state = refreshes.get(cwd);
      if (!state) {
        state = { running: false, pending: new Set(), timer: null };
        refreshes.set(cwd, state);
      }
      kinds.forEach((kind) => state.pending.add(kind));
      if (state.running || state.timer) return;
      state.timer = setTimeout(() => {
        state.timer = null;
        const pending = new Set(state.pending);
        state.pending.clear();
        state.running = true;
        const keys: (readonly unknown[])[] = pending.has("repository")
          ? [gitQueryKeys.history(cwd), gitQueryKeys.branches(cwd), ["git", "rebase-state", cwd]]
          : [];
        if (pending.has("files"))
          keys.push(gitQueryKeys.workingTreeDiffs(cwd), gitQueryKeys.sourceControlFiles(cwd));
        void Promise.all([
          ...keys.map((queryKey) =>
            queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false }),
          ),
          ...(pending.has("files")
            ? [
                queryClient.invalidateQueries(
                  {
                    queryKey: ["git", "media", cwd],
                    predicate: (query) =>
                      ["index", "workingTree"].includes(String(query.queryKey.at(-1))),
                  },
                  { cancelRefetch: false },
                ),
              ]
            : []),
        ]).finally(() => {
          state.running = false;
          if (!disposed && state.pending.size) schedule(cwd, []);
        });
      }, 150);
    };
    const subscriptions = new Map<string, () => void>();
    const reconcile = () => {
      const active = activeGitStatusCwds(queryClient);
      for (const [cwd, unsubscribe] of subscriptions) {
        if (!active.has(cwd)) {
          unsubscribe();
          subscriptions.delete(cwd);
          const refresh = refreshes.get(cwd);
          refresh?.pending.clear();
          if (refresh?.timer) clearTimeout(refresh.timer);
          refreshes.delete(cwd);
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
            if (event._tag === "snapshot") schedule(cwd, ["repository", "files"]);
            else if (event._tag === "localUpdated")
              schedule(cwd, event.repositoryChanged ? ["repository", "files"] : ["files"]);
            else schedule(cwd, ["repository"]);
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
      disposed = true;
      refreshes.forEach((state) => {
        if (state.timer) clearTimeout(state.timer);
      });
      unsubscribe();
      subscriptions.forEach((stop) => stop());
    };
  }, [queryClient]);
}
