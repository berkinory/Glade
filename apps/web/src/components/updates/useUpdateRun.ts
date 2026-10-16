import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { environmentServerConfigQueryOptions } from "../../lib/serverReactQuery";
import { ensureEnvironmentNativeApi } from "../../nativeApi";
import { updateProvider } from "../../providerUpdates";
import {
  groupByMachine,
  type MachineUpdates,
  type ProviderUpdateItem,
} from "./usePendingProviderUpdates";

export type UpdateRowResult =
  | { readonly status: "running" }
  | { readonly status: "done" }
  | { readonly status: "failed"; readonly reason: string };

export interface UpdateRun {
  // A snapshot taken at start, so finished rows keep showing after the provider list refreshes.
  readonly items: ReadonlyArray<ProviderUpdateItem>;
  readonly results: Readonly<Record<string, UpdateRowResult>>;
  readonly finished: boolean;
  // The app restart was selected but held back because a provider update failed.
  readonly restartHeld: boolean;
}

export interface UpdateFailure {
  readonly item: ProviderUpdateItem;
  readonly reason: string;
}

export function useUpdateRun() {
  const queryClient = useQueryClient();
  const [run, setRun] = useState<UpdateRun | null>(null);

  const record = (id: string, result: UpdateRowResult) =>
    setRun((current) => current && { ...current, results: { ...current.results, [id]: result } });

  // Machines update in parallel; one machine's providers update in turn, since their installers
  // may share a package manager.
  const updateMachine = async ({ environmentKey, items }: MachineUpdates) => {
    const failures: UpdateFailure[] = [];
    for (const item of items) {
      let reason: string | null;
      try {
        reason = await updateProvider(ensureEnvironmentNativeApi(environmentKey), item.provider);
      } catch (error) {
        reason = error instanceof Error ? error.message : "The machine is not connected.";
      }
      record(item.id, reason === null ? { status: "done" } : { status: "failed", reason });
      if (reason !== null) failures.push({ item, reason });
    }
    await queryClient
      .invalidateQueries({ queryKey: environmentServerConfigQueryOptions(environmentKey).queryKey })
      .catch(() => undefined);
    return failures;
  };

  const start = async (
    items: ReadonlyArray<ProviderUpdateItem>,
    restart: boolean,
  ): Promise<ReadonlyArray<UpdateFailure>> => {
    setRun({
      items,
      results: Object.fromEntries(items.map((item) => [item.id, { status: "running" }])),
      finished: false,
      restartHeld: false,
    });
    const failures = (await Promise.all(groupByMachine(items).map(updateMachine))).flat();
    setRun(
      (current) =>
        current && { ...current, finished: true, restartHeld: restart && failures.length > 0 },
    );
    return failures;
  };

  return { run, start, clear: () => setRun(null) };
}
