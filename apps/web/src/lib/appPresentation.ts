import type { GladeAppOpenRequest } from "@glade/contracts/provider/agentGatewayTools";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useRightDockStore } from "../rightDockStore";
import { useTerminalStateStore } from "../terminalStateStore";
import { useExplorerRevealRequestStore } from "../explorerRevealRequestStore";
import { acknowledgeAppPresentation } from "../wsNativeApi";

export async function presentAppRequest(
  request: GladeAppOpenRequest,
  navigate: (threadId: ThreadId) => Promise<void>,
): Promise<void> {
  let error: string | undefined;
  try {
    await navigate(request.threadId);
    const dock = useRightDockStore.getState();
    const target = request.target;
    if (target.kind === "file") {
      dock.openFile(request.threadId, target.path);
      useExplorerRevealRequestStore
        .getState()
        .requestReveal(
          request.threadId,
          target.path,
          target.path,
          target.line === undefined ? undefined : { lineNumber: target.line, column: 1 },
        );
    } else if (target.kind === "diff") {
      dock.openPane(request.threadId, {
        kind: "git",
        diffTurnId: target.turnId ?? null,
        diffFilePath: target.path ?? null,
      });
    } else {
      useTerminalStateStore.getState().openChatThreadPage(request.threadId);
      dock.openPane(request.threadId, { kind: "terminal" });
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Could not open the requested view.";
  }
  await acknowledgeAppPresentation({
    requestId: request.requestId,
    ...(error === undefined ? {} : { error }),
  });
}
