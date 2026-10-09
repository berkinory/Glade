import type { AuthScope, AuthSessionRole } from "@glade/contracts/transport/auth/auth";

const CLIENT_SCOPES: ReadonlyArray<AuthScope> = [
  "orchestration:read",
  "orchestration:operate",
  "filesystem:read",
  "filesystem:write",
  "source-control:write",
  "settings:write",
  "providers:manage",
];

// A paired device can do everything work needs, but cannot pair other devices, reach into the
// host's desktop apps or read raw diagnostics. Those stay with the machine's owner.
const SCOPES_BY_ROLE: Record<AuthSessionRole, ReadonlySet<AuthScope>> = {
  owner: new Set<AuthScope>([...CLIENT_SCOPES, "access:write", "host:control", "diagnostics:read"]),
  client: new Set(CLIENT_SCOPES),
};

export function scopesForRole(role: AuthSessionRole): ReadonlyArray<AuthScope> {
  return [...SCOPES_BY_ROLE[role]];
}

export function roleHasScope(role: AuthSessionRole, scope: AuthScope): boolean {
  return SCOPES_BY_ROLE[role].has(scope);
}
