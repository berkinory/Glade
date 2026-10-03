import type { Effect } from "effect";
import type { CodexThreadTitleInput } from "../codex/codexThreadTitle";
import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../core/Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface CodexAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "codex";
  readonly generateThreadTitle: (
    input: CodexThreadTitleInput,
  ) => Effect.Effect<string, ProviderAdapterError>;
}

export class CodexAdapter extends ServiceMap.Service<CodexAdapter, CodexAdapterShape>()(
  "glade/provider/Services/CodexAdapter",
) {}
