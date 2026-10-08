import type { TurnId } from "@glade/contracts/core/baseSchemas";

import { Button } from "~/components/ui/button";
import { ChatErrorNotice } from "../ChatErrorNotice";
import type { TurnFailureRecovery } from "./timelineSupport";

export function TurnFailureNotice({
  turnId,
  message,
  recovery,
}: {
  turnId: TurnId | null;
  message: string;
  recovery: TurnFailureRecovery | null;
}) {
  const recoverable = recovery !== null && turnId !== null && recovery.turnId === turnId;
  return (
    <div className="py-1" data-turn-failure={turnId ?? undefined}>
      <ChatErrorNotice
        title="Task failed before it finished"
        error={message}
        actions={
          recoverable ? (
            <>
              <Button
                size="xs"
                variant="outline"
                disabled={recovery.disabled}
                onClick={() => recovery.onContinue(turnId)}
              >
                Continue in this chat
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={recovery.disabled}
                onClick={recovery.onChangeModel}
              >
                Change model
              </Button>
            </>
          ) : null
        }
      />
    </div>
  );
}
