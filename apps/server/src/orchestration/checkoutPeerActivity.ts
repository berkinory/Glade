import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type {
  OrchestrationProject,
  OrchestrationThread,
} from "@glade/contracts/orchestration/threadEntities";
import type { ProviderSession } from "@glade/contracts/provider/provider";
import { Effect } from "effect";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils.ts";
import { resolveCheckoutRoot } from "../git/checkoutRoot.ts";
import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { threadHasInFlightTurn } from "./commandInvariants.ts";

export function providerSessionHasInFlightTurn(session: ProviderSession | undefined): boolean {
  return (
    session?.status === "connecting" ||
    session?.status === "running" ||
    (session?.status !== "error" && session?.status !== "closed" && session?.activeTurnId != null)
  );
}

// True when a thread outside `ownThreadIds` has a running, starting or queued turn in the same
// checkout as `cwd`. Restoring files under such a peer would silently drop or mix in its edits.
export const hasPeerTurnInCheckout = Effect.fnUntraced(function* (input: {
  readonly cwd: string;
  readonly ownThreadIds: ReadonlyArray<ThreadId>;
  readonly readModel: {
    readonly threads: ReadonlyArray<
      Pick<
        OrchestrationThread,
        | "id"
        | "deletedAt"
        | "projectId"
        | "envMode"
        | "worktreePath"
        | "workingDirectory"
        | "session"
        | "latestTurn"
      >
    >;
    readonly projects: ReadonlyArray<Pick<OrchestrationProject, "id" | "kind" | "workspaceRoot">>;
  };
  readonly providerSessions: ReadonlyArray<ProviderSession>;
  readonly hasPendingTurnStart: (
    threadId: ThreadId,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
}) {
  const roots = new Map<string, Promise<string | null>>();
  const rootOf = (cwd: string) => {
    let root = roots.get(cwd);
    if (root === undefined) {
      root = resolveCheckoutRoot(cwd);
      roots.set(cwd, root);
    }
    return Effect.promise(() => root);
  };
  const target = yield* rootOf(input.cwd);
  if (target === null) return false;
  const sharesCheckout = (cwd: string | null | undefined) =>
    cwd ? rootOf(cwd).pipe(Effect.map((root) => root === target)) : Effect.succeed(false);

  for (const session of input.providerSessions) {
    if (input.ownThreadIds.includes(session.threadId)) continue;
    if (providerSessionHasInFlightTurn(session) && (yield* sharesCheckout(session.cwd))) {
      return true;
    }
  }
  for (const peer of input.readModel.threads) {
    if (peer.deletedAt !== null || input.ownThreadIds.includes(peer.id)) continue;
    const peerCwd = resolveThreadWorkspaceCwd({ thread: peer, projects: input.readModel.projects });
    if (!(yield* sharesCheckout(peerCwd))) continue;
    if (threadHasInFlightTurn(peer)) return true;
    if (peer.session?.status !== "error" && (yield* input.hasPendingTurnStart(peer.id))) {
      return true;
    }
  }
  return false;
});
