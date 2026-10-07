import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ComputerAccessScope } from "@glade/contracts/computer/computerUse";
import { ServiceMap, type Effect } from "effect";

import type { AppIdentities } from "../appIdentities.ts";
import type { ComputerGrant, ComputerGrants } from "../computerGrants.ts";
import type { ComputerProgressGuard } from "../computerProgressGuard.ts";
import type { ComputerTasks } from "../computerTask.ts";
import type { WindowSnapshots } from "../windowSnapshots.ts";

interface ComputerGrantRequest {
  readonly threadId: ThreadId;
  readonly turnId: string | null;
  readonly app: string;
  readonly windowId: number | null;
  readonly scope: ComputerAccessScope;
}

interface ComputerAccessRequest extends ComputerGrantRequest {
  readonly windowTitle: string | null;
  readonly reason: string;
  // How long to wait for the user before answering "pending"; the card stays open either way.
  readonly waitMs: number;
}

export type ComputerAccessOutcome =
  | { readonly status: "granted"; readonly scope: ComputerAccessScope }
  | { readonly status: "denied" }
  | { readonly status: "pending" };

export interface ComputerAccessShape {
  readonly grants: ComputerGrants;
  readonly tasks: ComputerTasks;
  readonly snapshots: WindowSnapshots;
  readonly progress: ComputerProgressGuard;
  readonly apps: AppIdentities;
  // The grant covering the request, recorded first without a card when the thread's permission
  // mode (read at call time) allows it; null when the user has to be asked.
  readonly grantFor: (request: ComputerGrantRequest) => Effect.Effect<ComputerGrant | null>;
  // Shows the access card in the thread (or joins the open one for the same target) and waits.
  readonly requestAccess: (request: ComputerAccessRequest) => Effect.Effect<ComputerAccessOutcome>;
}

export class ComputerAccess extends ServiceMap.Service<ComputerAccess, ComputerAccessShape>()(
  "glade/computer/Services/ComputerAccess",
) {}
