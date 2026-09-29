import {
  DesktopOperationQueue as SharedDesktopOperationQueue,
  desktopOperationContext,
} from "@glade/shared/desktopOperationQueue";

import { ComputerBackendError } from "./ComputerBackend.ts";

export {
  assertDesktopOperationActive,
  desktopDeliveryMode,
  desktopOperationSignal,
  withDesktopDeliveryMode,
  withDesktopOperationSignal,
  withoutDesktopCancellation,
} from "@glade/shared/desktopOperationQueue";

// A detached continuation cannot turn a completed call into fresh input authority.
export function assertDesktopOperationAdmission(): void {
  const operation = desktopOperationContext();
  if (operation && !operation.active) {
    throw new ComputerBackendError(
      "The computer operation has ended; no new input may be dispatched.",
    );
  }
  operation?.signal?.throwIfAborted();
}

export class DesktopOperationQueue extends SharedDesktopOperationQueue {
  constructor() {
    super(ComputerBackendError);
  }
}
