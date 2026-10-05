import { LockKeyholeIcon, Globe02Icon, UsersIcon, User02Icon } from "~/lib/icons";
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { GitPublishContextResult } from "@glade/contracts/git/githubRepositoryPublishing";
import { isValidGitHubRepositoryNameWithOwner } from "@glade/shared/git/githubRepository";
import { ensureNativeApi } from "~/nativeApi";
import { invalidateGitQueriesForCwds } from "~/lib/gitQueryOptions";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Toggle } from "../ui/toggle";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
  dialogFieldLabelClassName,
} from "../ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectItem } from "../ui/select";
import { ComposerPickerSelectPopup } from "./ComposerPickerMenuPopup";
export function GitPublishDialog(props: {
  cwd: string;
  context: GitPublishContextResult;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const ownerId = useId();
  const nameId = useId();
  const repositoryId = useId();
  const visibilityId = useId();
  const [owner, setOwner] = useState(props.context.owner ?? "");
  const [name, setName] = useState(props.context.name);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const mutation = useMutation({
    mutationKey: ["git", "mutation", "publish-repository", props.cwd],
    mutationFn: () =>
      ensureNativeApi().git.publishRepository({
        cwd: props.cwd,
        owner: owner.trim(),
        name: name.trim(),
        visibility,
      }),
    onSettled: () => invalidateGitQueriesForCwds(queryClient, [props.cwd]),
    onSuccess: (result) => {
      if (result.status !== "published") return;
      toastManager.add({
        type: "success",
        title: "Published to GitHub",
        description: result.url,
      });
      props.onClose();
    },
  });
  const pushFailed = mutation.data?.status === "pushFailed" ? mutation.data : null;
  const disabled = mutation.isPending || Boolean(pushFailed);
  const repository = `${owner.trim()}/${name.trim()}`;
  const selectedOwner = props.context.owners.find((candidate) => candidate.login === owner);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose();
      }}
    >
      <DialogPopup className="max-w-sm" showCloseButton={!mutation.isPending}>
        <DialogHeader>
          <DialogTitle>Publish to GitHub</DialogTitle>
          <DialogDescription>
            Create a GitHub repository and publish your committed changes.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <div className="space-y-2">
            <span id={ownerId} className={dialogFieldLabelClassName}>
              Owner
            </span>
            <Select
              value={owner}
              disabled={disabled}
              onValueChange={(value) => {
                if (
                  typeof value === "string" &&
                  props.context.owners.some((candidate) => candidate.login === value)
                )
                  setOwner(value);
              }}
            >
              <SelectTrigger aria-labelledby={ownerId} className="w-full">
                <SelectValue>
                  <span className="flex min-w-0 items-center gap-2">
                    {selectedOwner?.kind === "organization" ? (
                      <UsersIcon className="size-4" aria-hidden="true" />
                    ) : (
                      <User02Icon className="size-4" aria-hidden="true" />
                    )}
                    <span className="truncate">{owner}</span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <ComposerPickerSelectPopup align="start">
                {props.context.owners.map((candidate) => (
                  <SelectItem key={candidate.login} value={candidate.login}>
                    <span className="flex items-center gap-2">
                      {candidate.kind === "organization" ? (
                        <UsersIcon className="size-4" aria-hidden="true" />
                      ) : (
                        <User02Icon className="size-4" aria-hidden="true" />
                      )}
                      {candidate.login}
                    </span>
                  </SelectItem>
                ))}
              </ComposerPickerSelectPopup>
            </Select>
          </div>
          <div className="space-y-2">
            <label htmlFor={nameId} className={dialogFieldLabelClassName}>
              Repository name
            </label>
            <Input
              id={nameId}
              value={name}
              disabled={disabled}
              autoCapitalize="off"
              spellCheck={false}
              aria-describedby={repositoryId}
              onChange={(event) => setName(event.target.value)}
            />
            <p id={repositoryId} className="break-all text-ui-xs text-muted-foreground">
              {repository}
            </p>
          </div>
          <div className="space-y-2">
            <span id={visibilityId} className={dialogFieldLabelClassName}>
              Visibility
            </span>
            <div role="group" aria-labelledby={visibilityId} className="grid grid-cols-2 gap-2">
              <Toggle
                variant="outline"
                size="lg"
                pressed={visibility === "private"}
                disabled={disabled}
                onPressedChange={() => setVisibility("private")}
              >
                <LockKeyholeIcon className="size-4" aria-hidden="true" />
                Private
              </Toggle>
              <Toggle
                variant="outline"
                size="lg"
                pressed={visibility === "public"}
                disabled={disabled}
                onPressedChange={() => setVisibility("public")}
              >
                <Globe02Icon className="size-4" aria-hidden="true" />
                Public
              </Toggle>
            </div>
            <p className="text-ui-xs text-muted-foreground">
              {visibility === "public"
                ? "Anyone can see the repository and its committed history."
                : "Only you and people you grant access can see this repository."}
            </p>
          </div>
          {mutation.error || pushFailed ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {pushFailed?.error ?? mutation.error?.message}
            </p>
          ) : null}
          {pushFailed ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void ensureNativeApi().shell.openExternal(pushFailed.url)}
            >
              Open GitHub repository
            </Button>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={mutation.isPending} onClick={props.onClose}>
            {pushFailed ? "Close" : "Cancel"}
          </Button>
          {!pushFailed ? (
            <Button
              disabled={disabled || !isValidGitHubRepositoryNameWithOwner(repository)}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? <Spinner variant="action" /> : null}
              {mutation.isPending ? "Publishing…" : "Publish repository"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
