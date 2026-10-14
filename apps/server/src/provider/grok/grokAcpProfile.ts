import type { PromptResponse, Usage } from "@agentclientprotocol/sdk";
import { asRecord } from "@glade/shared/transport/payloadValues";

import type { AcpProviderProfile } from "../acp/acpProviderProfile.ts";
import { GROK_CLI } from "./grokCli.ts";

// A private agent process instead of the shared leader, so Glade owns its lifetime and teardown.
const AGENT_ARGS = ["agent", "--no-leader", "stdio"];

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

// Grok Build reports a turn's usage, summed over its model calls, only in the response's `_meta`.
function grokPromptUsage(response: PromptResponse): Usage | undefined {
  const usage = asRecord(response._meta?.usage);
  const totalTokens = tokenCount(usage?.totalTokens);
  const inputTokens = tokenCount(usage?.inputTokens);
  const outputTokens = tokenCount(usage?.outputTokens);
  if (totalTokens === undefined || inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  return {
    totalTokens,
    inputTokens,
    outputTokens,
    thoughtTokens: tokenCount(usage?.reasoningTokens) ?? null,
    cachedReadTokens: tokenCount(usage?.cachedReadTokens) ?? null,
    cachedWriteTokens: tokenCount(usage?.cacheCreationTokens) ?? null,
  };
}

export const GROK_ACP_PROFILE: AcpProviderProfile = {
  provider: "grok",
  displayName: GROK_CLI.displayName,
  args: AGENT_ARGS,
  titleModel: "grok-4.7-build-fast",
  compactCommand: "compact",
  // Grok reads a first-prompt policy as an injected instruction and refuses it.
  argsWithSystemPrompt: (policy) => ["--rules", policy, ...AGENT_ARGS],
  promptUsage: grokPromptUsage,
  hiddenCommands: new Set(["goal", "loop", "workflow", "deep-research", "always-approve"]),
};
