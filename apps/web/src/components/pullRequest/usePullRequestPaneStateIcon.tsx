import type { PullRequestDetailInput } from "@glade/contracts/git/pullRequests";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { CHAT_SURFACE_CHIP_GLYPH_CLASS_NAME } from "~/components/chat/chatHeaderControls";
import { pullRequestDetailQueryOptions } from "../../lib/pullRequestQueryOptions";
import { PullRequestStateGlyph } from "./PullRequestStateGlyph";

export function usePullRequestPaneStateIcon(
  input: PullRequestDetailInput | null,
): ReactNode | undefined {
  const detailQuery = useQuery({
    ...pullRequestDetailQueryOptions(input),
    enabled: false,
  });
  const detail = input ? detailQuery.data : undefined;
  if (!detail) return undefined;

  return (
    <PullRequestStateGlyph
      state={detail.state}
      isDraft={detail.isDraft}
      mergeability={detail.mergeability}
      className={CHAT_SURFACE_CHIP_GLYPH_CLASS_NAME}
    />
  );
}
