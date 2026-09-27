// FILE: providerChildEnvironment.ts
// Purpose: Builds provider child environments without Glade control-plane authority.
// Layer: Server provider process security

export type ProviderChildKind = "acp" | "claude" | "codex" | "cursor" | "grok" | "opencode";

const PROVIDER_CREDENTIAL_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "GROK_CODE_XAI_API_KEY",
  "CURSOR_API_KEY",
  "DOCKER_AUTH_CONFIG",
]);

export function registerProviderCredentialKey(key: string): void {
  const normalized = key.trim().toUpperCase();
  if (/^[A-Z0-9_.-]+$/u.test(normalized)) {
    PROVIDER_CREDENTIAL_KEYS.add(normalized);
  }
}

export function isProviderCredentialKey(key: string): boolean {
  return PROVIDER_CREDENTIAL_KEYS.has(key.trim().toUpperCase());
}

const PROVIDER_CREDENTIAL_GRANTS: Record<ProviderChildKind, "all" | ReadonlySet<string>> = {
  claude: new Set([
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ]),
  cursor: new Set(["CURSOR_API_KEY"]),
  grok: new Set(["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"]),
  // These profiles deliberately support arbitrary upstream model providers.
  acp: "all",
  codex: "all",
  opencode: "all",
};

const INHERITED_NATIVE_CAPABILITY_KEYS = new Set([
  "BUN_OPTIONS",
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS",
]);

const isTestHarnessKey = (key: string, env: NodeJS.ProcessEnv): boolean =>
  Boolean(env.VITEST) && (key.startsWith("GLADE_FAKE_") || key.startsWith("GLADE_ACP_"));

export function buildProviderChildEnvironment(input: {
  readonly provider: ProviderChildKind;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly inheritedGladeKeys?: ReadonlyArray<string>;
  readonly inheritedNativeCapabilityKeys?: ReadonlyArray<string>;
  readonly overrides?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const baseEnv = {
    ...(input.baseEnv ?? process.env),
    ...input.overrides,
  };
  const allowedGladeKeys = new Set(input.inheritedGladeKeys ?? []);
  const allowedNativeCapabilities = new Set(input.inheritedNativeCapabilityKeys ?? []);
  const credentialGrants = PROVIDER_CREDENTIAL_GRANTS[input.provider];
  const childEnv: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (key.startsWith("GLADE_") && !allowedGladeKeys.has(key) && !isTestHarnessKey(key, baseEnv)) {
      continue;
    }
    if (INHERITED_NATIVE_CAPABILITY_KEYS.has(key) && !allowedNativeCapabilities.has(key)) {
      continue;
    }
    if (
      isProviderCredentialKey(key) &&
      credentialGrants !== "all" &&
      !credentialGrants.has(key.toUpperCase())
    ) {
      continue;
    }
    childEnv[key] = value;
  }

  return childEnv;
}
