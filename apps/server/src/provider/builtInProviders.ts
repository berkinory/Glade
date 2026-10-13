import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { CLAUDE_PROVIDER_DESCRIPTOR } from "./claude/claudeProviderDescriptor.ts";
import { CODEX_PROVIDER_DESCRIPTOR } from "./codex/codexProviderDescriptor.ts";
import { CURSOR_PROVIDER_DESCRIPTOR } from "./cursor/cursorProviderDescriptor.ts";
import { GROK_PROVIDER_DESCRIPTOR } from "./grok/grokProviderDescriptor.ts";
import { MUSE_PROVIDER_DESCRIPTOR } from "./muse/museProviderDescriptor.ts";
import { OPENCODE_PROVIDER_DESCRIPTOR } from "./opencode/opencodeProviderDescriptor.ts";
import type { ServerProviderDescriptor } from "./core/serverProviderDescriptor.ts";

// Listed in the order Glade presents providers.
export const BUILT_IN_PROVIDERS: ReadonlyArray<ServerProviderDescriptor> = [
  CODEX_PROVIDER_DESCRIPTOR,
  CLAUDE_PROVIDER_DESCRIPTOR,
  CURSOR_PROVIDER_DESCRIPTOR,
  GROK_PROVIDER_DESCRIPTOR,
  MUSE_PROVIDER_DESCRIPTOR,
  OPENCODE_PROVIDER_DESCRIPTOR,
];

export function serverProviderDescriptor(kind: ProviderKind): ServerProviderDescriptor {
  const descriptor = BUILT_IN_PROVIDERS.find((candidate) => candidate.kind === kind);
  if (!descriptor) throw new Error(`No built-in provider is registered for "${kind}".`);
  return descriptor;
}
