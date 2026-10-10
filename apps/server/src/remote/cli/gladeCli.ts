import type { RemoteAccessStatus } from "@glade/contracts/transport/ws/remoteAccessRpc";
import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import {
  bundleVersion,
  ensureServer,
  isAlive,
  logPath,
  readRecord,
  rootDir,
  runServerAttached,
  stopRunningServer,
  waitForRunningServer,
} from "../hostServer";
import {
  createPairing,
  NotRunning,
  pendingPairings,
  remoteStatus,
  updateRemote,
} from "./serverApi";
import {
  controlService,
  enableLinger,
  installService,
  removeService,
  serviceInstalled,
  serviceSupported,
} from "./service";
import {
  accent,
  bold,
  dim,
  green,
  header,
  line,
  liveLine,
  qrCode,
  red,
  step,
  yellow,
} from "./terminal";

const INSTALL_URL =
  process.env.GLADE_INSTALL_URL ??
  "https://github.com/berkinory/Glade/releases/latest/download/install.sh";
const shimPath = Path.join(OS.homedir(), ".glade/bin/glade");
const version = bundleVersion();

const COMMANDS: ReadonlyArray<readonly [string, string, string]> = [
  ["start", "", "Start Glade in the background"],
  ["stop", "", "Stop it"],
  ["restart", "", "Restart it"],
  ["status", "", "Show whether it runs and how devices reach it"],
  ["pair", "", "Show a QR code to pair a phone or computer"],
  ["remote on", "[--lan]", "Let paired devices in"],
  ["remote off", "", "Close access for other devices"],
  ["logs", "[-f]", "Show the server log"],
  ["update", "", "Install the latest Glade"],
  ["uninstall", "[--purge]", "Remove Glade; --purge also removes projects and chats"],
];

function usage(): void {
  line(`${bold("Usage")}  glade <command>`);
  line();
  const width = Math.max(...COMMANDS.map(([name, flags]) => `${name} ${flags}`.length));
  for (const [name, flags, description] of COMMANDS) {
    const padding = " ".repeat(width - `${name} ${flags}`.length + 2);
    line(`${accent(name)} ${dim(flags)}${padding}${description}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function describeRoutes(status: RemoteAccessStatus): void {
  if (!status.enabled) {
    line(`${dim("○")} Remote access is off. Turn it on with ${accent("glade remote on")}.`);
    return;
  }
  if (status.error) line(`${red("!")} ${status.error}`);
  for (const route of status.routes) line(`${green("●")} ${route.url} ${dim(route.kind)}`);
  if (status.tailscale.setupUrl) {
    line(
      `${yellow("!")} Turn on HTTPS for your tailnet, then run ${accent("glade remote on")} again:`,
    );
    line(`  ${status.tailscale.setupUrl}`);
  } else if (status.tailscale.error) {
    line(`${yellow("!")} Tailscale: ${status.tailscale.error}`);
  }
  if (status.routes.length === 0 && !status.error) {
    line(
      `${yellow("!")} No address reaches this machine yet. Try ${accent("glade remote on --lan")}.`,
    );
  }
}

async function start(): Promise<void> {
  await step(
    "Starting Glade",
    async () => {
      if (serviceInstalled()) {
        controlService("start");
        return waitForRunningServer();
      }
      return ensureServer(null);
    },
    (server) => `Glade is running ${dim(`on 127.0.0.1:${server.port}`)}`,
  );
}

async function stop(): Promise<void> {
  await step(
    "Stopping Glade",
    async () => {
      const record = readRecord();
      const wasRunning = record !== null && isAlive(record.pid);
      if (serviceInstalled()) controlService("stop");
      await stopRunningServer();
      return wasRunning;
    },
    (wasRunning) => (wasRunning ? "Glade stopped" : "Glade was not running"),
  );
}

async function status(): Promise<void> {
  const record = readRecord();
  if (!record || !isAlive(record.pid)) {
    line(`${dim("○")} Not running. Start it with ${accent("glade start")}.`);
    process.exitCode = 3;
    return;
  }
  line(`${green("●")} Running ${dim(`version ${record.version}, port ${record.port}`)}`);
  if (serviceInstalled()) line(`${green("●")} Starts on boot`);
  describeRoutes(await remoteStatus());
}

async function remote(args: ReadonlyArray<string>): Promise<void> {
  const [action] = args;
  if (action === "off") {
    await step(
      "Closing access for other devices",
      () => updateRemote({ enabled: false }),
      () => "Remote access is off; every device was disconnected",
    );
    return;
  }
  if (action !== "on") {
    describeRoutes(await remoteStatus());
    return;
  }
  const lan = args.includes("--lan");
  const current = await remoteStatus();
  const result = await step("Opening access for paired devices", () =>
    updateRemote({
      enabled: true,
      ...(lan ? { allowPlainHttp: true } : {}),
      ...(current.tailscale.state === "running" && !args.includes("--no-tailscale")
        ? { tailscaleHttps: true }
        : {}),
    }),
  );
  if (lan)
    line(`${yellow("!")} Local network connections are not encrypted. Use trusted networks only.`);
  describeRoutes(result);
}

async function pair(): Promise<void> {
  const status = await remoteStatus();
  if (!status.enabled || status.routes.length === 0) {
    describeRoutes(status);
    process.exitCode = 1;
    return;
  }
  const pairing = await createPairing();
  process.stdout.write(`${qrCode(pairing.url)}\n\n`);
  line(`Scan with your phone's camera, or open on another device:`);
  line(accent(pairing.url));
  process.stdout.write("\n");
  const expiresAt = Date.parse(String(pairing.expiresAt));
  const live = liveLine();
  // The code leaves the pending list the moment a device uses it.
  for (;;) {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      live.end(`${dim("○")} The code expired. Run ${accent("glade pair")} for a new one.`);
      process.exitCode = 1;
      return;
    }
    const { pendingPairingIds } = await pendingPairings();
    if (!pendingPairingIds.includes(pairing.id)) {
      live.end(`${green("✓")} Paired. The device can use Glade now.`);
      return;
    }
    const seconds = Math.ceil(remaining / 1000);
    live.update(
      `${accent("◌")} Waiting for a device ${dim(`· expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · works once`)}`,
    );
    await sleep(1000);
  }
}

async function logs(follow: boolean): Promise<void> {
  if (!FS.existsSync(logPath)) {
    line(`${dim("○")} No log yet.`);
    return;
  }
  const text = FS.readFileSync(logPath, "utf8");
  process.stdout.write(`${text.split("\n").slice(-80).join("\n")}`);
  if (!follow) return;
  let offset = Buffer.byteLength(text);
  for (;;) {
    await sleep(500);
    const size = FS.statSync(logPath).size;
    if (size < offset) offset = 0;
    if (size === offset) continue;
    const handle = FS.openSync(logPath, "r");
    const chunk = Buffer.alloc(size - offset);
    FS.readSync(handle, chunk, 0, chunk.length, offset);
    FS.closeSync(handle);
    process.stdout.write(chunk);
    offset = size;
  }
}

// Runs the published installer, which owns every install step; a mirror set through
// GLADE_INSTALL_URL may be plain HTTP, as the installer itself allows.
function update(): void {
  const proto = INSTALL_URL.startsWith("http://") ? "=http,https" : "=https";
  const curl = ChildProcess.spawnSync("sh", ["-c", "command -v curl"]).status === 0;
  const fetcher = curl
    ? `curl -fsSL --proto '${proto}' --tlsv1.2 "$GLADE_INSTALL_URL"`
    : `wget -qO- "$GLADE_INSTALL_URL"`;
  const result = ChildProcess.spawnSync("sh", ["-c", `${fetcher} | sh -s -- --update`], {
    stdio: "inherit",
    env: { ...process.env, GLADE_INSTALL_URL: INSTALL_URL },
  });
  process.exitCode = result.status ?? 1;
}

async function uninstall(purge: boolean): Promise<void> {
  await stop();
  if (serviceInstalled()) {
    await step(
      "Removing the service",
      async () => removeService(),
      () => "Service removed",
    );
  }
  await step(
    purge ? "Removing Glade and its data" : "Removing Glade",
    async () => {
      // Without --purge only the data stays: projects, chats and settings in `home`.
      for (const entry of FS.readdirSync(rootDir)) {
        if (purge || entry !== "home") {
          FS.rmSync(Path.join(rootDir, entry), { recursive: true, force: true });
        }
      }
      if (purge) FS.rmSync(rootDir, { recursive: true, force: true });
      FS.rmSync(Path.dirname(shimPath), { recursive: true, force: true });
      const link = Path.join(OS.homedir(), ".local/bin/glade");
      if (FS.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) FS.rmSync(link);
    },
    () => (purge ? "Glade and its data removed" : "Glade removed"),
  );
  if (!purge) line(dim(`Projects and chats stay in ${rootDir}/home.`));
}

// Used by the installer: start on boot when the system has a user service manager.
async function setupService(): Promise<void> {
  if (!serviceSupported()) {
    await start();
    line(dim("This system has no user service manager; run glade start after a reboot."));
    return;
  }
  await stopRunningServer();
  await step(
    "Starting Glade on boot",
    async () => {
      installService(shimPath, logPath);
      return waitForRunningServer();
    },
    () => `Glade starts on boot ${dim(process.platform === "darwin" ? "(launchd)" : "(systemd)")}`,
  );
  if (!enableLinger()) {
    line(`${yellow("!")} To keep Glade running after you log out, run once:`);
    line(`  sudo loginctl enable-linger ${OS.userInfo().username}`);
  }
}

async function dispatch(command: string, args: ReadonlyArray<string>): Promise<void> {
  switch (command) {
    case "start":
      return start();
    case "stop":
      return stop();
    case "restart":
      await stop();
      return start();
    case "status":
      return status();
    case "pair":
      return pair();
    case "remote":
      return remote(args);
    case "logs":
      return logs(args.includes("-f") || args.includes("--follow"));
    case "update":
      return update();
    case "uninstall":
      return uninstall(args.includes("--purge"));
    case "setup-service":
      return setupService();
    case "help":
    case "--help":
    case "-h":
      return usage();
    default:
      usage();
      line();
      line(`${red("✗")} Unknown command: ${command}`);
      process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "run") {
    process.exitCode = await runServerAttached();
    return;
  }
  if (command === "version" || command === "--version" || command === "-v") {
    process.stdout.write(`${version}\n`);
    return;
  }
  // The installer that `update` runs draws its own header and spacing.
  const framed = command !== "update" && !process.env.GLADE_NO_HEADER;
  if (framed) header(version);
  try {
    await dispatch(command, args);
  } catch (error) {
    line(`${red("✗")} ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof NotRunning) line(dim("Start it with glade start."));
    process.exitCode = 1;
  } finally {
    if (framed) process.stdout.write("\n");
  }
}

void main();
