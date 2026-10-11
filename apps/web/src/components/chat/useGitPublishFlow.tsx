import type { GitPublishContextResult } from "@glade/contracts/git/githubRepositoryPublishing";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ensureNativeApi } from "~/nativeApi";
import { toastManager } from "../ui/toast";
import { GitPublishDialog } from "./GitPublishDialog";

export function useGitPublishFlow(cwd: string | null) {
  const [context, setContext] = useState<GitPublishContextResult | null>(null);
  const mutation = useMutation({
    mutationFn: (dir: string) => ensureNativeApi().git.publishContext({ cwd: dir }),
  });
  const start = (onHasRemote: () => void) => {
    if (!cwd) return;
    mutation.mutate(cwd, {
      onSuccess: (result) => (result.hasRemote ? onHasRemote() : setContext(result)),
      onError: (error) =>
        toastManager.add({
          type: "error",
          title: "Could not prepare push",
          description: error.message,
        }),
    });
  };
  const dialog =
    cwd && context ? (
      <GitPublishDialog cwd={cwd} context={context} onClose={() => setContext(null)} />
    ) : null;
  return { start, isPending: mutation.isPending, dialog };
}
