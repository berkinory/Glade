import type { PullRequestActor } from "@glade/contracts";

import { cn } from "~/lib/utils";
import { AuthorAvatar } from "../AuthorAvatar";

export function PullRequestActorLabel({
  actor,
  className,
}: {
  actor: PullRequestActor | null;
  className?: string;
}) {
  const login = actor?.login ?? "ghost";
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)} title={login}>
      <AuthorAvatar actor={actor} size="sm" />
      <span className="truncate">{login}</span>
    </span>
  );
}
