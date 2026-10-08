import {
  GIT_NOT_FOUND_ERROR_CODE,
  GIT_UNSAFE_REPOSITORY_ERROR_CODE,
} from "@glade/contracts/git/git";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateGitQueriesForCwds } from "~/lib/gitQueryOptions";
import { ensureNativeApi } from "~/nativeApi";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { PanelStateMessage } from "./PanelStateMessage";

export function SourceControlRepositoryError(props: {
  cwd: string;
  error: Error;
  onRetry: () => void;
}) {
  const queryClient = useQueryClient();
  const code = "code" in props.error ? props.error.code : undefined;
  const trust = useMutation({
    mutationFn: () => ensureNativeApi().git.trustRepository({ cwd: props.cwd }),
    onSuccess: props.onRetry,
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Could not trust this folder",
        description: error.message,
      }),
    onSettled: () => invalidateGitQueriesForCwds(queryClient, [props.cwd]),
  });
  const title =
    code === GIT_NOT_FOUND_ERROR_CODE
      ? "Git is not installed or not on PATH."
      : code === GIT_UNSAFE_REPOSITORY_ERROR_CODE
        ? "Git does not trust this folder because another user owns it."
        : "Could not check this folder’s Git repository.";
  return (
    <PanelStateMessage>
      <div className="flex max-w-full flex-col items-center gap-2">
        <span className="text-foreground">{title}</span>
        <pre className="max-h-40 max-w-full overflow-auto whitespace-pre-wrap break-words text-left font-mono text-ui-xs select-text">
          {props.error.message}
        </pre>
        {code === GIT_UNSAFE_REPOSITORY_ERROR_CODE ? (
          <>
            <span className="text-ui-sm">
              Trusting it adds this folder to safe.directory in your global Git config, so every Git
              tool on this computer will use it.
            </span>
            <Button size="sm" disabled={trust.isPending} onClick={() => trust.mutate()}>
              {trust.isPending ? <Spinner variant="action" /> : null}
              Trust this folder
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="outline" onClick={props.onRetry}>
          Retry
        </Button>
      </div>
    </PanelStateMessage>
  );
}
