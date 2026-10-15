import type { GitHubConnectionStatus } from "@glade/contracts/git/githubConnection";
import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "~/lib/icons";
import { ensureNativeApi } from "~/nativeApi";
import { AuthorAvatar } from "../AuthorAvatar";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { SettingsStatus, type SettingsStatusTone } from "./SettingsStatus";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

function describeConnection(status: GitHubConnectionStatus): {
  tone: SettingsStatusTone;
  label: string;
  hint: string;
} {
  switch (status.state) {
    case "connected":
      return {
        tone: "granted",
        label: "Signed in",
        hint: "Pull requests, checks and merges use this GitHub CLI account.",
      };
    case "not_installed":
      return {
        tone: "needed",
        label: "GitHub CLI not found",
        hint: "Install the GitHub CLI (gh) to create pull requests, read checks and merge.",
      };
    case "signed_out":
      return {
        tone: "needed",
        label: "Not signed in",
        hint: "Run gh auth login in a terminal, then check again.",
      };
    case "error":
      return { tone: "blocked", label: "Status unavailable", hint: status.detail };
  }
}

export function GitHubConnectionSettings() {
  const connection = useQuery({
    queryKey: ["git", "github-connection"],
    queryFn: () => ensureNativeApi().git.githubConnection(),
    staleTime: 60_000,
  });
  const account = connection.data?.state === "connected" ? connection.data : null;
  const accountName = account?.name && account.name !== account.login ? account.name : null;
  const description = connection.data ? describeConnection(connection.data) : null;
  return (
    <SettingsSection title="GitHub">
      <SettingsRow
        id="setting-github-cli"
        title={
          // The avatar slot is the same size before and after the account loads, so the row keeps
          // its height while the sign-in is checked.
          <span className="flex min-w-0 items-center gap-2">
            {account ? (
              <AuthorAvatar actor={account} size="md" />
            ) : (
              <span aria-hidden className="size-5 shrink-0 rounded-full bg-muted" />
            )}
            <span className="truncate">
              {account ? (accountName ?? `@${account.login}`) : "GitHub CLI"}
            </span>
            {accountName ? (
              <span className="truncate font-normal text-muted-foreground">@{account?.login}</span>
            ) : null}
          </span>
        }
        description={
          description?.hint ?? "Pull requests, checks and merges use your GitHub CLI sign-in."
        }
        status={
          connection.isPending ? (
            <SettingsStatus tone="checking" label="Checking sign-in" />
          ) : connection.isError ? (
            <SettingsStatus tone="blocked" label={connection.error.message} />
          ) : description ? (
            <SettingsStatus tone={description.tone} label={description.label} />
          ) : null
        }
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={connection.isFetching}
            onClick={() => void connection.refetch()}
          >
            {connection.isFetching ? <Spinner variant="action" /> : <RefreshCwIcon />}
            Check again
          </Button>
        }
      />
    </SettingsSection>
  );
}
