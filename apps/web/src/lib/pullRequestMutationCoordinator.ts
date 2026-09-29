import type { PullRequestDetailInput, PullRequestState } from "@glade/contracts";
import type { QueryClient } from "@tanstack/react-query";

export type PullRequestActionPatch = { state?: PullRequestState; isDraft?: boolean };

type ActionProtection = {
  identityKey: string;
  id: number;
  patch: Readonly<PullRequestActionPatch>;
  outcome: "pending" | "succeeded" | "failed";
};

export type PullRequestActionReadFence = ReadonlyMap<string, ReadonlyArray<ActionProtection>>;

const protectionStateByClient = new WeakMap<
  QueryClient,
  { nextId: number; byIdentity: Map<string, Map<number, ActionProtection>> }
>();
const EMPTY_READ_FENCE: PullRequestActionReadFence = new Map();

function remoteIdentity(input: Pick<PullRequestDetailInput, "repository" | "number">): string {
  return JSON.stringify([input.repository.toLowerCase(), input.number]);
}

function protectionState(queryClient: QueryClient) {
  const current = protectionStateByClient.get(queryClient);
  if (current) return current;
  const created = { nextId: 0, byIdentity: new Map<string, Map<number, ActionProtection>>() };
  protectionStateByClient.set(queryClient, created);
  return created;
}

export function beginPullRequestActionProtection(
  queryClient: QueryClient,
  input: Pick<PullRequestDetailInput, "repository" | "number">,
  patch: PullRequestActionPatch,
): ActionProtection {
  const state = protectionState(queryClient);
  const identityKey = remoteIdentity(input);
  const protection: ActionProtection = {
    identityKey,
    id: ++state.nextId,
    patch,
    outcome: "pending",
  };
  if (Object.keys(patch).length === 0) return protection;
  const active = state.byIdentity.get(identityKey) ?? new Map<number, ActionProtection>();
  active.set(protection.id, protection);
  state.byIdentity.set(identityKey, active);
  return protection;
}

export function finishPullRequestActionProtection(
  queryClient: QueryClient,
  protection: ActionProtection,
  outcome: "succeeded" | "failed",
): void {
  if (protection.outcome === "pending") protection.outcome = outcome;
  const state = protectionStateByClient.get(queryClient);
  const active = state?.byIdentity.get(protection.identityKey);
  if (!active?.delete(protection.id)) return;
  if (active.size === 0) state?.byIdentity.delete(protection.identityKey);
}

/** A read that started before an action settled must still respect its successful intent. */
export function capturePullRequestActionReadFence(
  queryClient: QueryClient,
): PullRequestActionReadFence {
  const state = protectionStateByClient.get(queryClient);
  if (!state || state.byIdentity.size === 0) return EMPTY_READ_FENCE;
  return new Map(
    [...state.byIdentity].map(([key, protections]) => [key, [...protections.values()]]),
  );
}

export function hasPullRequestActionReadProtection(
  queryClient: QueryClient,
  readFence?: PullRequestActionReadFence,
): boolean {
  return (
    (readFence?.size ?? 0) > 0 ||
    (protectionStateByClient.get(queryClient)?.byIdentity.size ?? 0) > 0
  );
}

export function activePullRequestActionPatch(
  queryClient: QueryClient,
  input: Pick<PullRequestDetailInput, "repository" | "number">,
  readFence?: PullRequestActionReadFence,
): PullRequestActionPatch {
  const identityKey = remoteIdentity(input);
  const protections = new Map<number, ActionProtection>();
  for (const protection of readFence?.get(identityKey) ?? []) {
    protections.set(protection.id, protection);
  }
  for (const protection of protectionStateByClient
    .get(queryClient)
    ?.byIdentity.get(identityKey)
    ?.values() ?? []) {
    protections.set(protection.id, protection);
  }
  const patch: PullRequestActionPatch = {};
  for (const protection of [...protections.values()].toSorted((a, b) => a.id - b.id)) {
    if (protection.outcome === "failed") continue;
    if (protection.patch.state !== undefined) patch.state = protection.patch.state;
    if (protection.patch.isDraft !== undefined) patch.isDraft = protection.patch.isDraft;
  }
  return patch;
}
