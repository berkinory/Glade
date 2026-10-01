import { ServiceMap } from "effect";
import type { GitManagerShape } from "./GitManager.ts";

export type GitHandoffShape = Pick<GitManagerShape, "handoffThread">;

export class GitHandoff extends ServiceMap.Service<GitHandoff, GitHandoffShape>()(
  "glade/git/Services/GitHandoff",
) {}
