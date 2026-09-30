import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useState } from "react";
import { toastManager } from "../components/ui/toast";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";

export function useThreadCompaction(threadId: ThreadId | undefined) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const compact = async (instructions?: string): Promise<boolean> => {
    const api = readNativeApi();
    if (!api || !threadId || isSubmitting) return false;
    setIsSubmitting(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.compact",
        commandId: newCommandId(),
        threadId,
        ...(instructions?.trim() ? { instructions: instructions.trim() } : {}),
        createdAt: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not compact conversation",
        description: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };
  return { compact, isSubmitting };
}
