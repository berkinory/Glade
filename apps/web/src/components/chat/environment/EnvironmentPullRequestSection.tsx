import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { useQuery } from "@tanstack/react-query";
import { gitStatusQueryOptions } from "../../../lib/gitQueryOptions";
import { GitPullRequestIcon } from "~/lib/icons";
import {
  PR_STATE_PRESENTATION_ICONS,
  resolvePrStatePresentation,
} from "../../pullRequest/pullRequestStatePresentation";
import { ENVIRONMENT_ROW_CLASS_NAME, EnvironmentLabeledSection } from "./EnvironmentRow";

export function EnvironmentPullRequestSection({
  gitCwd,
  enabled,
  onOpenUrl,
  onClose,
}: {
  gitCwd: string | null;
  enabled: boolean;
  activeThreadId: ThreadId | null;
  projectId: ProjectId | null;
  configuredRepositories: ReadonlyArray<{ readonly nameWithOwner: string }>;
  showDiffColors?: boolean;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}) {
  const { data: status } = useQuery(gitStatusQueryOptions(gitCwd, enabled));
  const pr = status?.pr;
  if (!pr) return null;
  const presentation = resolvePrStatePresentation(pr);
  const Icon = PR_STATE_PRESENTATION_ICONS[presentation.iconKind] ?? GitPullRequestIcon;
  return (
    <EnvironmentLabeledSection label="Pull request">
      <button
        type="button"
        className={ENVIRONMENT_ROW_CLASS_NAME}
        title={`Open #${pr.number} on GitHub`}
        onClick={() => {
          onOpenUrl(pr.url);
          onClose();
        }}
      >
        <Icon className={`size-4 shrink-0 ${presentation.colorClass}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          #{pr.number} {pr.title}
        </span>
        <span className="shrink-0 text-ui-xs text-muted-foreground">{presentation.label}</span>
      </button>
    </EnvironmentLabeledSection>
  );
}
