import type { GitHubConnectionStatus } from "@glade/contracts/git/githubConnection";
import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "~/lib/icons";
import { ensureNativeApi } from "~/nativeApi";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

function describeConnection(status: GitHubConnectionStatus): {
  label: string;
  hint: string | null;
} {
  switch (status.state) {
    case "connected":
      return { label: `Connected as @${status.login}`, hint: null };
    case "not_installed":
      return {
        label: "GitHub CLI not found",
        hint: "Install the GitHub CLI (`gh`) to create pull requests, read checks and merge.",
      };
    case "signed_out":
      return {
        label: "Not signed in",
        hint: "Run `gh auth login` in a terminal, then check again.",
      };
    case "error":
      return { label: "Status unavailable", hint: status.detail };
  }
}

export function GitHubConnectionSettings() {
  const connection = useQuery({
    queryKey: ["git", "github-connection"],
    queryFn: () => ensureNativeApi().git.githubConnection(),
    staleTime: 60_000,
  });
  const description = connection.data ? describeConnection(connection.data) : null;
  return (
    <SettingsSection title="GitHub">
      <SettingsRow
        title="GitHub CLI"
        description="Pull requests, checks and merges use your GitHub CLI sign-in."
        status={
          connection.isPending ? (
            "Checking..."
          ) : connection.isError ? (
            connection.error.message
          ) : description ? (
            <span className="flex flex-col gap-0.5">
              <span
                className={
                  connection.data?.state === "connected" ? "text-foreground" : "text-warning"
                }
              >
                {description.label}
              </span>
              {description.hint ? <span>{description.hint}</span> : null}
            </span>
          ) : null
        }
        control={
          <Button
            size="xs"
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
