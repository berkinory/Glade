import type { DesktopSshHost } from "@glade/contracts/ipc/sshHosts";
import { expandHomePath } from "@glade/shared/platform/gladeHome";
import { spawnProcess } from "@glade/shared/platform/processRuntime";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import type { Readable } from "node:stream";
import type { SshTarget } from "./sshAskpass";

// Windows OpenSSH cannot multiplex, so each command opens its own connection there. Elsewhere the
// connections share one authenticated master. The socket path stays short because Unix sockets
// are limited to ~104 bytes and the macOS temp directory alone uses most of that.
function controlOptions(): string[] {
  if (process.platform === "win32") return [];
  const directory = Path.join("/tmp", `glade-ssh-${OS.userInfo().uid}`);
  FS.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return [
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${directory}/%C`,
    "-o",
    "ControlPersist=60",
  ];
}

// ssh asks its questions (unknown host keys, passwords, passphrases) through SSH_ASKPASS, which
// Glade answers (see sshAskpass.ts); one password attempt per connection keeps a remembered wrong
// password from being retried. Port forwards requested through a shared master outlive the client
// that asked for them, so the tunnel opts out of multiplexing and owns its connection.
function sshArgs(
  host: DesktopSshHost,
  extra: ReadonlyArray<string>,
  options: { readonly multiplex: boolean } = { multiplex: true },
): string[] {
  return [
    "-o",
    "BatchMode=no",
    "-o",
    "NumberOfPasswordPrompts=1",
    "-o",
    "ConnectTimeout=15",
    // A network that drops silently (a VPN going down) sends no reset; three missed 5 s keepalives
    // end the tunnel within ~15 s so reconnecting starts while the user still looks at the chat.
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=3",
    ...(options.multiplex ? controlOptions() : ["-o", "ControlPath=none"]),
    ...(host.port !== null ? ["-p", String(host.port)] : []),
    ...(host.identityFile !== null ? ["-i", expandHomePath(host.identityFile)] : []),
    ...extra,
    "--",
    host.destination,
  ];
}

export function spawnSsh(
  target: SshTarget,
  invocation: {
    // Options go before the destination; the command, if any, runs on the host after it.
    readonly options?: ReadonlyArray<string>;
    readonly command?: string;
    readonly multiplex?: boolean;
  },
): ChildProcessWithoutNullStreams {
  const args = sshArgs(target.host, invocation.options ?? [], {
    multiplex: invocation.multiplex ?? true,
  });
  return spawnProcess("ssh", invocation.command ? [...args, invocation.command] : args, {
    env: { ...process.env, ...target.env },
    requireExecutable: true,
  });
}

export function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// The remote login shell may be fish or csh, so scripts always run under POSIX sh.
// ssh or the command it ran failed. `stdout` carries any markers a script printed before failing.
export class SshFailure extends Error {
  constructor(
    message: string,
    readonly authRejected: boolean,
    readonly stdout = "",
  ) {
    super(message);
  }
}

export function sshFailure(code: number | null, stderr: string, stdout = ""): SshFailure {
  return new SshFailure(
    describeSshFailure(code, stderr),
    /Permission denied/u.test(stderr),
    stdout,
  );
}

export function runRemoteScript(
  target: SshTarget,
  script: string,
  options: {
    readonly stdin?: Readable;
    readonly timeoutMs: number;
    readonly onLine?: (line: string) => void;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnSsh(target, { command: `sh -c ${quoteShell(script)}` });
    let stdout = "";
    let pendingLine = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      if (!options.onLine) return;
      const lines = (pendingLine + chunk).split("\n");
      pendingLine = lines.pop() ?? "";
      for (const line of lines) options.onLine(line);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ssh did not finish within ${options.timeoutMs / 1000}s.`));
    }, options.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not run ssh: ${error.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(sshFailure(code, stderr, stdout));
    });
    // A remote command that exits early closes its stdin; the exit code reports that failure, so the
    // resulting EPIPE must not surface as an unhandled stream error in the main process.
    child.stdin.on("error", () => undefined);
    if (options.stdin) {
      options.stdin.once("error", (error) => {
        child.kill();
        reject(error);
      });
      options.stdin.pipe(child.stdin);
    } else {
      child.stdin.end();
    }
  });
}

function describeSshFailure(code: number | null, stderr: string): string {
  const detail = stderr.trim().split("\n").slice(-6).join("\n");
  // ssh refuses a changed key without asking; trusting it again is the user's call, made knowingly.
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/u.test(stderr)) {
    return "The host's key changed since you last connected. If the host was reinstalled, remove its old key with ssh-keygen -R and connect again; otherwise someone may be intercepting the connection.";
  }
  if (/Host key verification failed/u.test(stderr)) {
    return "The host key was not trusted.";
  }
  if (/Permission denied/u.test(stderr)) {
    return "SSH rejected the login. Check the password, key or SSH agent.";
  }
  return detail.length > 0 ? detail : `ssh exited with code ${code ?? "unknown"}.`;
}
