import { lazyModule } from "../lazyModule.ts";

export type ClaudeAgentSdkModule = typeof import("@anthropic-ai/claude-agent-sdk");

// Importing it eagerly costs ~26ms on every server boot, including boots that never touch a Claude
// session, so every consumer (adapter, health probe, thread import) shares this one loader instead
// of a top-level import.
export const loadClaudeAgentSdk: () => Promise<ClaudeAgentSdkModule> = lazyModule(
  () => import("@anthropic-ai/claude-agent-sdk"),
);
