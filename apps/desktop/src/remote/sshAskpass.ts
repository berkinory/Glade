import type { DesktopSshHost, DesktopSshPrompt } from "@glade/contracts/ipc/sshHosts";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

// The environment one ssh invocation runs with. It routes ssh's questions (unknown host keys,
// passwords, key passphrases) to Glade instead of a terminal it does not have.
export interface SshTarget {
  readonly host: DesktopSshHost;
  readonly env: Readonly<Record<string, string>>;
}

interface AskpassSession {
  readonly target: SshTarget;
  // Only an interactive attempt shows questions to the user; others answer from what the user
  // already entered and decline the rest. Each call starts a new attempt.
  setInteractive(interactive: boolean): void;
  // What the session last declined because nobody could answer it.
  declined(): DesktopSshPrompt["kind"] | null;
  close(): void;
}

export interface SshAskpass {
  openSession(host: DesktopSshHost): AskpassSession;
  answer(promptId: string, answer: string | null): void;
  // Drops remembered passwords after a rejected login, so the next attempt asks again.
  forgetSecrets(hostId: string): void;
  prompts(): ReadonlyArray<DesktopSshPrompt>;
  close(): void;
}

const PROMPT_TIMEOUT_MS = 3 * 60_000;
const MAX_REQUEST_BYTES = 16 * 1024;

// Runs under Glade's own binary in Node mode (ELECTRON_RUN_AS_NODE), so the helper needs no runtime
// of its own. It prints the answer for ssh, or exits non-zero to decline.
const HELPER_SOURCE = `import { connect } from "node:net";
const socket = connect(process.env.GLADE_ASKPASS_SOCKET);
let reply = "";
socket.setEncoding("utf8");
socket.on("data", (chunk) => { reply += chunk; });
socket.on("end", () => {
  try {
    const { answer } = JSON.parse(reply);
    if (typeof answer === "string") { process.stdout.write(answer + "\\n"); process.exit(0); }
  } catch {}
  process.exit(1);
});
socket.on("error", () => process.exit(1));
socket.end(JSON.stringify({
  token: process.env.GLADE_ASKPASS_TOKEN,
  session: process.env.GLADE_ASKPASS_SESSION,
  prompt: process.argv[2] ?? "",
}));
`;

function classify(message: string): DesktopSshPrompt["kind"] {
  if (/authenticity of host|continue connecting/iu.test(message)) return "host-key";
  if (/passphrase/iu.test(message)) return "passphrase";
  if (/password/iu.test(message)) return "password";
  return "secret";
}

// SSH_ASKPASS must name one executable, so a wrapper starts the helper with Glade's binary.
function writeHelper(directory: string): string {
  const script = Path.join(directory, "askpass.mjs");
  FS.writeFileSync(script, HELPER_SOURCE, { mode: 0o600 });
  if (process.platform === "win32") {
    const wrapper = Path.join(directory, "askpass.cmd");
    FS.writeFileSync(
      wrapper,
      '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%GLADE_ASKPASS_NODE%" "%GLADE_ASKPASS_SCRIPT%" %*\r\n',
    );
    return wrapper;
  }
  const wrapper = Path.join(directory, "askpass.sh");
  FS.writeFileSync(
    wrapper,
    '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$GLADE_ASKPASS_NODE" "$GLADE_ASKPASS_SCRIPT" "$@"\n',
    { mode: 0o700 },
  );
  return wrapper;
}

interface SessionState {
  readonly host: DesktopSshHost;
  interactive: boolean;
  declined: DesktopSshPrompt["kind"] | null;
}

interface PendingPrompt {
  readonly prompt: DesktopSshPrompt;
  readonly sessionId: string;
  readonly reply: (answer: string | null) => void;
}

export function createSshAskpass(options: {
  readonly publish: (prompts: ReadonlyArray<DesktopSshPrompt>) => void;
}): SshAskpass {
  const token = Crypto.randomBytes(32).toString("hex");
  // A private directory keeps the socket and helper away from other users; Unix socket paths are
  // limited to ~104 bytes, which the macOS temporary directory alone mostly uses up.
  const directory =
    process.platform === "win32"
      ? FS.mkdtempSync(Path.join(OS.tmpdir(), "glade-askpass-"))
      : FS.mkdtempSync(Path.join("/tmp", `glade-askpass-${OS.userInfo().uid}-`));
  FS.chmodSync(directory, 0o700);
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\glade-askpass-${Crypto.randomBytes(8).toString("hex")}`
      : Path.join(directory, "askpass.sock");
  const helperScript = Path.join(directory, "askpass.mjs");
  const wrapper = writeHelper(directory);
  const sessions = new Map<string, SessionState>();
  const pending = new Map<string, PendingPrompt>();
  // Answers live only in memory, per host and per exact question, until a login is rejected.
  const secrets = new Map<string, Map<string, string>>();

  const publish = () => options.publish([...pending.values()].map((entry) => entry.prompt));

  function settle(promptId: string, answer: string | null): void {
    const entry = pending.get(promptId);
    if (!entry) return;
    pending.delete(promptId);
    publish();
    entry.reply(answer);
  }

  function handle(request: unknown, reply: (answer: string | null) => void): void {
    const fields =
      typeof request === "object" && request !== null ? (request as Record<string, unknown>) : {};
    const session = typeof fields.session === "string" ? sessions.get(fields.session) : undefined;
    if (fields.token !== token || !session || typeof fields.prompt !== "string") {
      reply(null);
      return;
    }
    const message = fields.prompt.trim();
    const kind = classify(message);
    const remembered = kind === "host-key" ? undefined : secrets.get(session.host.id)?.get(message);
    if (remembered !== undefined) {
      reply(remembered);
      return;
    }
    if (!session.interactive) {
      session.declined = kind;
      reply(null);
      return;
    }
    const prompt: DesktopSshPrompt = {
      id: Crypto.randomUUID(),
      hostId: session.host.id,
      hostLabel: session.host.label,
      kind,
      message,
    };
    const timer = setTimeout(() => settle(prompt.id, null), PROMPT_TIMEOUT_MS);
    pending.set(prompt.id, {
      prompt,
      sessionId: fields.session as string,
      reply: (answer) => {
        clearTimeout(timer);
        if (answer === null) session.declined = kind;
        else if (kind !== "host-key") {
          const hostSecrets = secrets.get(session.host.id) ?? new Map<string, string>();
          hostSecrets.set(message, answer);
          secrets.set(session.host.id, hostSecrets);
        }
        reply(answer);
      },
    });
    publish();
  }

  const server = Net.createServer((socket) => {
    let body = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_REQUEST_BYTES) socket.destroy();
    });
    socket.on("error", () => undefined);
    socket.on("end", () => {
      let request: unknown = null;
      try {
        request = JSON.parse(body);
      } catch {
        // A malformed request is declined below like any unknown one.
      }
      handle(request, (answer) => {
        if (!socket.destroyed) socket.end(JSON.stringify({ answer }));
      });
    });
  });
  server.listen(socketPath);

  return {
    openSession(host) {
      const id = Crypto.randomUUID();
      const state: SessionState = { host, interactive: false, declined: null };
      sessions.set(id, state);
      return {
        target: {
          host,
          env: {
            SSH_ASKPASS: wrapper,
            SSH_ASKPASS_REQUIRE: "force",
            GLADE_ASKPASS_NODE: process.execPath,
            GLADE_ASKPASS_SCRIPT: helperScript,
            GLADE_ASKPASS_SOCKET: socketPath,
            GLADE_ASKPASS_TOKEN: token,
            GLADE_ASKPASS_SESSION: id,
          },
        },
        setInteractive(interactive) {
          state.interactive = interactive;
          state.declined = null;
        },
        declined: () => state.declined,
        close() {
          sessions.delete(id);
          for (const [promptId, entry] of pending) {
            if (entry.sessionId === id) settle(promptId, null);
          }
        },
      };
    },
    answer: settle,
    forgetSecrets(hostId) {
      secrets.delete(hostId);
    },
    prompts: () => [...pending.values()].map((entry) => entry.prompt),
    close() {
      for (const promptId of [...pending.keys()]) settle(promptId, null);
      server.close();
      FS.rmSync(directory, { recursive: true, force: true });
    },
  };
}
