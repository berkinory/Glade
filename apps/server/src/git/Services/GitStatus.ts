import { Effect, ServiceMap } from "effect";
import type { GitCommandError } from "../Errors.ts";
import type { GitCoreShape } from "./GitCore.ts";

interface GitUpstreamRef {
  readonly upstreamRef: string;
  readonly remoteName: string;
  readonly upstreamBranch: string;
}

export interface GitStatusShape extends Pick<
  GitCoreShape,
  "status" | "statusDetails" | "readBranchContext"
> {
  readonly branchExists: (cwd: string, branch: string) => Effect.Effect<boolean, GitCommandError>;
  readonly remoteBranchExists: (
    cwd: string,
    remoteName: string,
    branch: string,
  ) => Effect.Effect<boolean, GitCommandError>;
  readonly resolveCurrentUpstream: (
    cwd: string,
  ) => Effect.Effect<GitUpstreamRef | null, GitCommandError>;
  readonly refreshCheckedOutBranchUpstream: (cwd: string) => Effect.Effect<void, GitCommandError>;
  readonly resolvePrimaryRemoteName: (cwd: string) => Effect.Effect<string, GitCommandError>;
  readonly resolveBaseBranchForNoUpstream: (
    cwd: string,
    branch: string,
  ) => Effect.Effect<string | null, GitCommandError>;
}

export class GitStatus extends ServiceMap.Service<GitStatus, GitStatusShape>()(
  "glade/git/Services/GitStatus",
) {}
