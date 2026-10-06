import { Effect, ServiceMap } from "effect";
import type { GitCommandError } from "../Errors";

export interface RepositoryMetadata {
  readonly commonDir: string;
  readonly configValue: (key: string) => string | undefined;
  readonly hasRef: (ref: string) => boolean;
  readonly primaryRemote: string | null;
  readonly defaultBranch: string | null;
}

export class GitRepositoryMetadata extends ServiceMap.Service<
  GitRepositoryMetadata,
  { readonly read: (cwd: string) => Effect.Effect<RepositoryMetadata, GitCommandError> }
>()("glade/git/Services/GitRepositoryMetadata") {}
