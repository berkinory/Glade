import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ComputerAccessScope } from "@glade/contracts/computer/computerUse";
import { ServiceMap, type Effect } from "effect";

import type { ComputerGrants } from "../computerGrants.ts";
import type { ComputerTasks } from "../computerTask.ts";

interface ComputerAccessRequest {
  readonly threadId: ThreadId;
  readonly turnId: string | null;
  readonly app: string;
  readonly windowId: number | null;
  readonly windowTitle: string | null;
  readonly scope: ComputerAccessScope;
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
  // Shows the access card in the thread (or joins the open one for the same target) and waits.
  readonly requestAccess: (request: ComputerAccessRequest) => Effect.Effect<ComputerAccessOutcome>;
}

export class ComputerAccess extends ServiceMap.Service<ComputerAccess, ComputerAccessShape>()(
  "glade/computer/Services/ComputerAccess",
) {}
