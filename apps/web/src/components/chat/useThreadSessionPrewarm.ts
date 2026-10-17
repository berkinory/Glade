import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ModelSelection, RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { useEffect, useRef } from "react";
import { readNativeApi } from "~/nativeApi";

// The server keeps a prewarmed runtime for 90 seconds; asking again while the reader keeps typing
// renews it well before that.
const PREWARM_RENEW_MS = 30_000;

/**
 * Asks the server to start the thread's provider runtime while the reader types the message that
 * will need it, so the send does not wait for process startup.
 */
export function useThreadSessionPrewarm(input: {
  readonly threadId: ThreadId;
  readonly prompt: string;
  // False while a runtime is already up or the next send cannot be predicted.
  readonly eligible: boolean;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly draft: {
    readonly projectId: ProjectId;
    readonly workingDirectory: string | null;
  } | null;
}) {
  const { threadId, prompt, eligible, modelSelection, runtimeMode, draft } = input;
  const lastRequestRef = useRef<{ readonly key: string; readonly at: number } | null>(null);
  const typing = prompt.trim().length > 0;

  useEffect(() => {
    if (!eligible || !typing) return;
    const key = JSON.stringify([threadId, modelSelection, runtimeMode, draft]);
    const now = Date.now();
    const last = lastRequestRef.current;
    if (last?.key === key && now - last.at < PREWARM_RENEW_MS) return;
    lastRequestRef.current = { key, at: now };
    void readNativeApi()
      ?.orchestration.prewarmThreadSession({
        threadId,
        modelSelection,
        runtimeMode,
        ...(draft ? { draft } : {}),
      })
      .catch(() => undefined);
  }, [eligible, typing, prompt, threadId, modelSelection, runtimeMode, draft]);
}
