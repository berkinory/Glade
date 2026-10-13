import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

// Continues a chat a usage limit stopped once the limit resets.
export interface UsageLimitResumeShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class UsageLimitResume extends ServiceMap.Service<UsageLimitResume, UsageLimitResumeShape>()(
  "glade/orchestration/Services/UsageLimitResume",
) {}
