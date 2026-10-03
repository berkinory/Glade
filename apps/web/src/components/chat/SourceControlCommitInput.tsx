import { useMutation } from "@tanstack/react-query";
import { IconSparkles } from "@tabler/icons-react";
import { getProviderStartOptions, useAppSettings } from "~/appSettings";
import { ensureNativeApi } from "~/nativeApi";
import { useCopyToClipboard } from "~/lib/clipboard";
import { useCommitDrafts } from "./commitDraftStore";
import { GitCommitIcon } from "~/lib/icons";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Textarea } from "../ui/textarea";
import { Spinner } from "../ui/spinner";
import { assertCommitScope, readCommitScope, type CommitScope } from "./sourceControlCommitScope";
import { toastManager } from "../ui/toast";

export function SourceControlCommitInput(props: {
  cwd: string;
  message: string;
  canCommit: boolean;
  canGenerate: boolean;
  committing: boolean;
  onChange: (message: string) => void;
  onGenerated: (message: string, scope: CommitScope) => void;
  onCommit: () => void;
}) {
  const { settings } = useAppSettings();
  const generationError = useCommitDrafts((state) => state.generationErrors[props.cwd]);
  const setGenerationError = useCommitDrafts((state) => state.setGenerationError);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Could not copy error details",
        description: error.message,
      }),
  });
  const generation = useMutation({
    mutationFn: async (cwd: string) => {
      const scope = await readCommitScope(cwd);
      const result = await ensureNativeApi().git.generateCommitMessage({
        cwd,
        ...(settings.textGenerationModel
          ? { textGenerationModel: settings.textGenerationModel }
          : {}),
        ...(settings.textGenerationModel
          ? {
              textGenerationModelSelection: {
                provider: settings.textGenerationProvider ?? "codex",
                model: settings.textGenerationModel,
              },
            }
          : {}),
        ...(settings.codexHomePath ? { codexHomePath: settings.codexHomePath } : {}),
        providerOptions: getProviderStartOptions(settings),
      });
      assertCommitScope(scope, await readCommitScope(cwd));
      return { message: result.message, scope };
    },
    onError: (error, cwd) => setGenerationError(cwd, error.message),
    onSuccess: (_result, cwd) => setGenerationError(cwd, undefined),
  });
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <Textarea
            aria-label="Commit message"
            placeholder="Commit message"
            size="xs"
            className="flex rounded-md"
            trailingAction={
              <IconButton
                size="icon-chip"
                label="Generate commit message"
                tooltip="Generate commit message with AI"
                disabled={!props.canGenerate || generation.isPending}
                onClick={() =>
                  generation.mutate(props.cwd, {
                    onSuccess: (result) => props.onGenerated(result.message, result.scope),
                  })
                }
              >
                {generation.isPending ? (
                  <Spinner variant="action" className="size-3.5" />
                ) : (
                  <IconSparkles className="size-3.5" />
                )}
              </IconButton>
            }
            rows={1}
            value={props.message}
            disabled={props.committing}
            onChange={(event) => props.onChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                if (props.canCommit && !generation.isPending) props.onCommit();
              }
            }}
          />
        </div>
        <Button
          size="xs"
          variant="secondary"
          className="h-7.5 sm:h-7.5"
          disabled={!props.canCommit || generation.isPending}
          onClick={props.onCommit}
        >
          {props.committing ? (
            <Spinner variant="action" className="size-4" />
          ) : (
            <GitCommitIcon className="size-4" />
          )}{" "}
          Commit
        </Button>
      </div>
      {generationError && (
        <div
          role="alert"
          className="min-w-0 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-ui-xs"
        >
          <p className="font-medium text-destructive">Could not generate commit message</p>
          <p className="mt-1 select-text whitespace-pre-wrap break-words">{generationError}</p>
          <Button
            size="xs"
            variant="ghost"
            className="mt-1"
            onClick={() => copyToClipboard(generationError, undefined)}
          >
            {isCopied ? "Copied" : "Copy error details"}
          </Button>
        </div>
      )}
    </div>
  );
}
