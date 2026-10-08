import type { DesktopSshTransferProgress } from "@glade/contracts/ipc/sshHosts";
import {
  REMOTE_SERVER_LAUNCH_MARKER,
  RemoteServerLaunch,
} from "@glade/contracts/remote/remoteServer";
import {
  compareRemoteServerVersions,
  REMOTE_SERVER_LAUNCHER_PATH,
  REMOTE_SERVER_NODE_PATH,
  REMOTE_SERVER_READY_FILE,
  REMOTE_SERVER_ROOT,
  REMOTE_SERVER_RUNTIME_DIR,
  REMOTE_SERVER_SMOKE_PATH,
  remoteServerRuntimeName,
  type RemoteServerTarget,
} from "@glade/shared/remote/remoteServerBundle";
import { Option, Schema } from "effect";
import * as FS from "node:fs";
import type { RemoteServerBundle, RemoteServerBundleSource } from "./remoteServerBundle";
import type { SshTarget } from "./sshAskpass";
import { quoteShell, runRemoteScript, SshFailure } from "./sshCommand";

const PROBE_MARKER = "GLADE_REMOTE_PROBE ";
const RUNNING_MARKER = "GLADE_REMOTE_RUNNING ";
const MACHINE_MARKER = "GLADE_REMOTE_MACHINE ";
const BYTES_MARKER = "GLADE_INSTALL_BYTES ";
const UNPACKING_MARKER = "GLADE_INSTALL_UNPACKING";
const ERROR_MARKER = "GLADE_INSTALL_ERROR ";
const decodeLaunch = Schema.decodeUnknownOption(Schema.fromJsonString(RemoteServerLaunch));

type RemoteInstallPhase = "connecting" | "downloading" | "installing" | "starting";
type OnPhase = (phase: RemoteInstallPhase, progress: DesktopSshTransferProgress | null) => void;

const INSTALL_ERRORS: Record<string, string> = {
  "no-downloader": "The host needs curl or wget to download the Glade server.",
  download: "The host could not download the Glade server. It needs HTTPS access to github.com.",
  "no-checksum-tool": "The host needs sha256sum or shasum to verify the Glade server.",
  checksum: "The Glade server downloaded on the host failed its checksum.",
  unpack: "The host could not unpack the Glade server.",
  smoke: "The Glade server does not run on this host.",
};

// Reads the host's platform, its machine id and the server it already runs. The machine id lives
// beside the host's Glade data, so it names that data; noclobber creates it exactly once. The
// record holds tokens, so only its version and runtime leave the host.
const PROBE_SCRIPT = [
  `printf '${PROBE_MARKER}%s %s\\n' "$(uname -s)" "$(uname -m)"`,
  `root="$HOME/${REMOTE_SERVER_ROOT}"`,
  'mkdir -p "$root"',
  `[ -s "$root/machine-id" ] || (set -C; od -An -N16 -tx1 /dev/urandom | tr -d ' \\n' > "$root/machine-id") 2>/dev/null || true`,
  `printf '${MACHINE_MARKER}%s\\n' "$(cat "$root/machine-id")"`,
  'record="$root/server.json"',
  '[ -f "$record" ] || exit 0',
  `pid=$(sed -n 's/.*"pid":\\([0-9]*\\).*/\\1/p' "$record")`,
  '[ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || exit 0',
  `version=$(sed -n 's/.*"version":"\\([^"]*\\)".*/\\1/p' "$record")`,
  `runtime=$(sed -n 's/.*"runtime":"\\([^"]*\\)".*/\\1/p' "$record")`,
  `printf '${RUNNING_MARKER}%s %s\\n' "$version" "\${runtime:--}"`,
].join("\n");

function parseTarget(os: string, machine: string): RemoteServerTarget | null {
  const platform = os === "Linux" ? "linux" : os === "Darwin" ? "darwin" : null;
  const arch =
    machine === "x86_64" || machine === "amd64"
      ? "x64"
      : machine === "aarch64" || machine === "arm64"
        ? "arm64"
        : null;
  return platform && arch ? `${platform}-${arch}` : null;
}

function markedLine(output: string, marker: string): string | null {
  const line = output.split("\n").find((candidate) => candidate.startsWith(marker));
  return line ? line.slice(marker.length).trim() : null;
}

const runtimePath = (runtime: string) => `"$HOME/${REMOTE_SERVER_RUNTIME_DIR}/${runtime}"`;

// Fetches the archive into a staging directory, verifies its digest, unpacks it and runs the bundle's
// dependency smoke test before renaming it into place, so a host only ever sees complete builds
// that load on its libc and architecture.
function installScript(runtime: string, bundle: RemoteServerBundle): string {
  const fetchArchive =
    bundle.kind === "download"
      ? [
          `url=${quoteShell(bundle.url)}`,
          'if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 2 -o "$archive" "$url" &',
          'elif command -v wget >/dev/null 2>&1; then wget -q -O "$archive" "$url" &',
          "else fail no-downloader; fi",
          "pid=$!",
          'while kill -0 "$pid" 2>/dev/null; do',
          `  if [ -f "$archive" ]; then printf '${BYTES_MARKER}%s\\n' "$(wc -c < "$archive")"; fi`,
          "  sleep 1",
          "done",
          'wait "$pid" || fail download',
        ]
      : ['cat > "$archive"'];
  return [
    "set -e",
    `fail() { printf '${ERROR_MARKER}%s\\n' "$1"; exit 1; }`,
    `root="$HOME/${REMOTE_SERVER_RUNTIME_DIR}"`,
    'mkdir -p "$root"',
    'staging=$(mktemp -d "$root/.install.XXXXXX")',
    "trap 'rm -rf \"$staging\"' EXIT",
    'archive="$staging/bundle.tar.gz"',
    ...fetchArchive,
    'if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$archive" | cut -d" " -f1)',
    'elif command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "$archive" | cut -d" " -f1)',
    "else fail no-checksum-tool; fi",
    `[ "$actual" = ${quoteShell(bundle.sha256)} ] || fail checksum`,
    `printf '${UNPACKING_MARKER}\\n'`,
    'mkdir "$staging/bundle"',
    'tar -xzf "$archive" -C "$staging/bundle" --strip-components=1 || fail unpack',
    'rm -f "$archive"',
    `"$staging/bundle/${REMOTE_SERVER_NODE_PATH}" "$staging/bundle/${REMOTE_SERVER_SMOKE_PATH}" >"$staging/smoke.log" 2>&1 || { tail -n 8 "$staging/smoke.log" >&2; fail smoke; }`,
    `touch "$staging/bundle/${REMOTE_SERVER_READY_FILE}"`,
    `rm -rf ${runtimePath(runtime)}`,
    `mv "$staging/bundle" ${runtimePath(runtime)}`,
  ].join("\n");
}

async function install(
  target: SshTarget,
  runtime: string,
  bundle: RemoteServerBundle,
  onPhase: OnPhase,
): Promise<void> {
  const totalBytes = bundle.sizeBytes;
  const progress = (doneBytes: number) =>
    totalBytes ? { doneBytes: Math.min(doneBytes, totalBytes), totalBytes } : null;
  let stdin: FS.ReadStream | undefined;
  if (bundle.kind === "upload") {
    let doneBytes = 0;
    stdin = FS.createReadStream(bundle.file);
    stdin.on("data", (chunk) => {
      doneBytes += chunk.length;
      onPhase("installing", progress(doneBytes));
    });
    onPhase("installing", progress(0));
  } else {
    onPhase("downloading", progress(0));
  }
  try {
    await runRemoteScript(target, installScript(runtime, bundle), {
      ...(stdin ? { stdin } : {}),
      timeoutMs: 15 * 60_000,
      onLine: (line) => {
        if (line.startsWith(BYTES_MARKER)) {
          onPhase("downloading", progress(Number(line.slice(BYTES_MARKER.length).trim()) || 0));
        } else if (line === UNPACKING_MARKER) {
          onPhase("installing", null);
        }
      },
    });
  } catch (error) {
    if (!(error instanceof SshFailure)) throw error;
    const code = markedLine(error.stdout, ERROR_MARKER);
    const known = code ? INSTALL_ERRORS[code] : undefined;
    if (!known) throw error;
    // The smoke test's own output names the missing library or unsupported CPU.
    throw new Error(code === "smoke" ? `${known}\n${error.message}` : known, { cause: error });
  }
}

// Starts (or reuses) the host's Glade server, installing this desktop's build first unless the host
// already runs a newer version: an older server cannot open a database a newer one migrated, so a
// newer server is never replaced. Every step is idempotent, so a reconnect simply runs it again.
export async function ensureRemoteServer(input: {
  readonly target: SshTarget;
  readonly version: string;
  readonly bundles: RemoteServerBundleSource;
  readonly devUrl: string | null;
  // Throws when the host is not the machine this host entry reached before.
  readonly verifyMachine: (machineId: string) => void;
  readonly onPhase: OnPhase;
}): Promise<RemoteServerLaunch> {
  const { target: ssh } = input;
  input.onPhase("connecting", null);
  const probe = await runRemoteScript(ssh, PROBE_SCRIPT, { timeoutMs: 30_000 });
  const [os = "", machine = ""] = (markedLine(probe, PROBE_MARKER) ?? "").split(" ");
  const target = parseTarget(os, machine);
  if (!target) throw new Error(`Glade cannot run on this host (${os} ${machine}).`);
  const machineId = markedLine(probe, MACHINE_MARKER) ?? "";
  if (!/^[0-9a-f]{32}$/u.test(machineId)) throw new Error("Glade could not identify this host.");
  input.verifyMachine(machineId);
  const [runningVersion = "", runningRuntime = "-"] = (
    markedLine(probe, RUNNING_MARKER) ?? ""
  ).split(" ");

  let runtime: string;
  if (runningRuntime !== "-" && compareRemoteServerVersions(runningVersion, input.version) > 0) {
    runtime = runningRuntime;
  } else {
    const bundle = await input.bundles.resolve(target);
    runtime = remoteServerRuntimeName(input.version, target, bundle.sha256);
    const installed = await runRemoteScript(
      ssh,
      `test -f ${runtimePath(runtime)}/${REMOTE_SERVER_READY_FILE} && echo installed || true`,
      { timeoutMs: 30_000 },
    );
    if (installed.trim().split("\n").at(-1) !== "installed") {
      await install(ssh, runtime, bundle, input.onPhase);
    }
  }

  input.onPhase("starting", null);
  const output = await runRemoteScript(
    ssh,
    `exec ${runtimePath(runtime)}/${REMOTE_SERVER_NODE_PATH} ${runtimePath(runtime)}/${REMOTE_SERVER_LAUNCHER_PATH} start${
      input.devUrl ? ` --dev-url ${quoteShell(input.devUrl)}` : ""
    }`,
    { timeoutMs: 3 * 60_000 },
  );
  const launch = decodeLaunch(markedLine(output, REMOTE_SERVER_LAUNCH_MARKER) ?? "");
  if (Option.isNone(launch)) throw new Error("The Glade server on this host gave no address.");
  if (compareRemoteServerVersions(launch.value.version, input.version) < 0) {
    throw new Error(`The host runs Glade ${launch.value.version}, expected ${input.version}.`);
  }
  return launch.value;
}
