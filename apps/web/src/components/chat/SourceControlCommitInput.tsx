import { DEFAULT_GIT_TEXT_GENERATION_MODEL } from "@glade/contracts";
import { useMutation } from "@tanstack/react-query";
import { IconSparkles } from "@tabler/icons-react";
import { getProviderStartOptions, useAppSettings } from "~/appSettings";
import { ensureNativeApi } from "~/nativeApi";
import { GitCommitIcon } from "~/lib/icons";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Textarea } from "../ui/textarea";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";

export function SourceControlCommitInput(props: {
  cwd: string;
  message: string;
  canCommit: boolean;
  canGenerate: boolean;
  committing: boolean;
  onChange: (message: string) => void;
  onGenerated: (message: string) => void;
  onCommit: () => void;
}) {
  const { settings } = useAppSettings();
  const generation = useMutation({
    mutationFn: () =>
      ensureNativeApi().git.generateCommitMessage({
        cwd: props.cwd,
        textGenerationModel: settings.textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL,
        textGenerationModelSelection: {
          provider: settings.textGenerationProvider ?? "codex",
          model: settings.textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL,
        },
        ...(settings.codexHomePath ? { codexHomePath: settings.codexHomePath } : {}),
        providerOptions: getProviderStartOptions(settings),
      }),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Could not generate commit message",
        description: error.message,
      }),
  });
  return (
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
                generation.mutate(undefined, {
                  onSuccess: (result) => props.onGenerated(result.message),
                })
              }
            >
              {generation.isPending ? (
                <Spinner className="size-3.5" />
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
        {props.committing ? <Spinner className="size-4" /> : <GitCommitIcon className="size-4" />}{" "}
        Commit
      </Button>
    </div>
  );
}
