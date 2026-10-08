import { Schema } from "effect";

const SshHostLabel = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80));

// Passed to ssh as its destination argument, so a leading "-" would be parsed as an option.
const SshDestination = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.isPattern(/^[^\s-][^\s]*$/u),
);

const SshIdentityFile = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1024),
  Schema.isPattern(/^(?:~\/|\/)[^\n\r]*$/u),
);

export const DesktopSshHostInput = Schema.Struct({
  id: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(64))),
  label: SshHostLabel,
  destination: SshDestination,
  port: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
  identityFile: Schema.NullOr(SshIdentityFile),
});
export type DesktopSshHostInput = typeof DesktopSshHostInput.Type;

export const DesktopSshHost = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  label: SshHostLabel,
  destination: SshDestination,
  port: DesktopSshHostInput.fields.port,
  identityFile: DesktopSshHostInput.fields.identityFile,
});
export type DesktopSshHost = typeof DesktopSshHost.Type;

export type DesktopSshConnectionPhase =
  | "connecting"
  | "downloading"
  | "installing"
  | "starting"
  | "connected"
  | "reconnecting"
  | "failed";

// Bytes moved while downloading the server bundle or uploading it to the host.
export interface DesktopSshTransferProgress {
  readonly doneBytes: number;
  readonly totalBytes: number;
}

export interface DesktopSshConnectionState {
  readonly hostId: string;
  readonly phase: DesktopSshConnectionPhase;
  readonly detail: string | null;
  readonly progress: DesktopSshTransferProgress | null;
  // Why a failed connection needs the user rather than another automatic try: the host's Glade data
  // is not the one this app connected to before (reset on the host, or the address now reaches
  // another machine), or ssh asks for a password, passphrase or host key nobody answered.
  readonly issue: "machine-changed" | "needs-sign-in" | null;
  // The host server's address through the local tunnel. It stays the same across tunnel
  // reconnects and changes only when the host's server is replaced (a new token).
  readonly wsUrl: string | null;
}

// A host the user's SSH configuration or known_hosts already knows, offered when adding a host.
export interface DesktopSshDiscoveredHost {
  readonly alias: string;
  readonly source: "ssh-config" | "known-hosts";
}

// A question ssh asked while connecting: trusting an unknown host key, or a password or key
// passphrase. `message` is ssh's own text, including the key fingerprint for host keys.
export interface DesktopSshPrompt {
  readonly id: string;
  readonly hostId: string;
  readonly hostLabel: string;
  readonly kind: "host-key" | "password" | "passphrase" | "secret";
  readonly message: string;
}

// Editors whose Remote-SSH extension opens `<scheme>://vscode-remote/ssh-remote+<host><path>`.
export const DESKTOP_SSH_REMOTE_EDITORS = ["cursor", "vscode"] as const;
export type DesktopSshRemoteEditor = (typeof DESKTOP_SSH_REMOTE_EDITORS)[number];
