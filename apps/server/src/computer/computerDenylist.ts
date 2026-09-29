import { basename } from "node:path";

import { ComputerTargetError } from "./uiTreeTargeting.ts";

// Password managers and OS security UI have no agent override. Match bundle IDs, names, executable
// paths and PID identities so alternate spellings cannot bypass refusal. Window enumeration reveals
// presence only; scoped reads and input remain denied.
const COMPUTER_DENYLIST_BUNDLE_IDS: ReadonlySet<string> = new Set([
  "com.1password.1password",
  "com.agilebits.onepassword",
  "com.apple.keychainaccess",
  "com.apple.passwords",
  "com.apple.systempreferences",
  "com.apple.securityagent",
  "com.apple.security.authorization",
  "com.lastpass.lastpass",
  "com.bitwarden.desktop",
]);

const COMPUTER_DENYLIST_BUNDLE_PREFIXES: readonly string[] = [
  "com.agilebits.onepassword",
  "com.dashlane.",
];

const COMPUTER_DENYLIST_APP_NAMES: ReadonlySet<string> = new Set([
  "1password",
  "keychain access",
  "passwords",
  "system settings",
  "system preferences",
  "securityagent",
  "securityagenthelper",
  "bitwarden",
  "dashlane",
  "lastpass",
]);

export interface ComputerDenylistMatch {
  readonly app: string;

  readonly matched: string;
}

function normalizeComputerAppName(raw: string): string {
  let name = raw.trim();

  if (name.includes("/")) name = basename(name);
  if (name.toLowerCase().endsWith(".app")) name = name.slice(0, -4);
  return name.toLowerCase().replace(/\s+/g, " ");
}

function matchesComputerDenylistString(raw: string): string | undefined {
  const name = normalizeComputerAppName(raw);
  for (const denied of COMPUTER_DENYLIST_APP_NAMES) {
    if (name === denied || name.startsWith(`${denied} `)) return `app name ${denied}`;
  }

  const bundleId = name.replace(/\s+/g, "");
  if (COMPUTER_DENYLIST_BUNDLE_IDS.has(bundleId)) return `bundle id ${bundleId}`;
  for (const prefix of COMPUTER_DENYLIST_BUNDLE_PREFIXES) {
    if (bundleId.startsWith(prefix)) return `bundle id ${prefix}*`;
  }
  return undefined;
}

// Every field is optional because each surface reports a different subset: a launch arg may be only
// a name, a window row carries a name and never a bundle id.
export function computerDenylistMatch(identity: {
  readonly name?: string | undefined;
  readonly bundleId?: string | undefined;
}): ComputerDenylistMatch | undefined {
  const fromName =
    identity.name === undefined ? undefined : matchesComputerDenylistString(identity.name);
  if (fromName !== undefined) {
    return { app: identity.name ?? "the target app", matched: fromName };
  }
  const fromBundle =
    identity.bundleId === undefined ? undefined : matchesComputerDenylistString(identity.bundleId);
  if (fromBundle !== undefined) {
    return { app: identity.name ?? identity.bundleId ?? "the target app", matched: fromBundle };
  }
  return undefined;
}

export class ComputerDenylistError extends ComputerTargetError {
  readonly app: string;

  constructor(app: string, matched: string) {
    super({
      code: "computer_denylist_refused",
      message:
        `${app} is on the computer-control denylist (${matched}): password managers ` +
        "and OS security surfaces are refused, with no override in this build.",
    });
    this.name = "ComputerDenylistError";
    this.app = app;
  }
}
