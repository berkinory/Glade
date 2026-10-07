import type {
  BrowserFailureCode,
  BrowserHostMethod,
  BrowserHostResult,
} from "@glade/contracts/browser/browserHost";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Data, ServiceMap, type Effect } from "effect";

export class BrowserHostError extends Data.TaggedError("BrowserHostError")<{
  readonly code: BrowserFailureCode;
  readonly message: string;
}> {}

export interface BrowserHostShape {
  // False outside the desktop app; browser tools are not offered then.
  readonly available: boolean;
  // Params are the decoded tool input plus the caller's scope; the desktop decodes them again
  // against the method's contract schema.
  readonly call: (
    method: BrowserHostMethod,
    params: Readonly<Record<string, unknown>> & {
      readonly threadId: ThreadId;
      readonly workspaceDir: string | null;
    },
  ) => Effect.Effect<BrowserHostResult, BrowserHostError>;
}

export class BrowserHost extends ServiceMap.Service<BrowserHost, BrowserHostShape>()(
  "glade/browser/Services/BrowserHost",
) {}
