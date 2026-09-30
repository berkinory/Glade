import type { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";

const ONBOARDING_TERMINAL_SCOPE_PREFIX = "onboarding-terminal:";

// Two tabs or windows signing in to the same provider would otherwise share one PTY, so each client
// gets a nonce for the lifetime of the page.
const CLIENT_NONCE = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

export function onboardingTerminalThreadId(provider: ProviderKind): ThreadId {
  return `${ONBOARDING_TERMINAL_SCOPE_PREFIX}${CLIENT_NONCE}:${provider}` as ThreadId;
}
