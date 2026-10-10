import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

// Keeps Glade running across logouts and reboots with the system's own service manager: a systemd
// user unit on Linux, a launchd agent on macOS. The service runs `glade run`, which supervises one
// server in the foreground.

const LABEL = "dev.glade.server";
const UNIT = "glade.service";

const systemdUnitPath = Path.join(OS.homedir(), ".config/systemd/user", UNIT);
const launchAgentPath = Path.join(OS.homedir(), "Library/LaunchAgents", `${LABEL}.plist`);

function run(command: string, args: ReadonlyArray<string>): { ok: boolean; output: string } {
  const result = ChildProcess.spawnSync(command, args, { encoding: "utf8" });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

const launchDomain = () => `gui/${process.getuid?.() ?? 0}`;

export function serviceInstalled(): boolean {
  return FS.existsSync(process.platform === "darwin" ? launchAgentPath : systemdUnitPath);
}

export function serviceSupported(): boolean {
  if (process.platform === "darwin") return true;
  return run("systemctl", ["--user", "show-environment"]).ok;
}

export function installService(shimPath: string, logPath: string): void {
  if (process.platform === "darwin") {
    FS.mkdirSync(Path.dirname(launchAgentPath), { recursive: true });
    FS.writeFileSync(
      launchAgentPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${shimPath}</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict></plist>
`,
    );
    run("launchctl", ["bootout", `${launchDomain()}/${LABEL}`]);
    const loaded = run("launchctl", ["bootstrap", launchDomain(), launchAgentPath]);
    if (!loaded.ok) throw new Error(`launchd refused the Glade agent: ${loaded.output}`);
    return;
  }
  FS.mkdirSync(Path.dirname(systemdUnitPath), { recursive: true });
  FS.writeFileSync(
    systemdUnitPath,
    `[Unit]
Description=Glade
After=network-online.target

[Service]
ExecStart=${shimPath} run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`,
  );
  run("systemctl", ["--user", "daemon-reload"]);
  const enabled = run("systemctl", ["--user", "enable", "--now", UNIT]);
  if (!enabled.ok) throw new Error(`systemd refused the Glade service: ${enabled.output}`);
}

// A user service stops at logout unless lingering is on. Most systems let a user turn it on for
// themselves; when they do not, the caller tells the user the one command that does.
export function enableLinger(): boolean {
  if (process.platform === "darwin") return true;
  const user = OS.userInfo().username;
  if (run("loginctl", ["show-user", user, "--property=Linger"]).output.includes("Linger=yes")) {
    return true;
  }
  return run("loginctl", ["enable-linger", user]).ok;
}

export function removeService(): void {
  if (process.platform === "darwin") {
    run("launchctl", ["bootout", `${launchDomain()}/${LABEL}`]);
    FS.rmSync(launchAgentPath, { force: true });
    return;
  }
  run("systemctl", ["--user", "disable", "--now", UNIT]);
  FS.rmSync(systemdUnitPath, { force: true });
  run("systemctl", ["--user", "daemon-reload"]);
}

export function controlService(action: "start" | "stop" | "restart"): void {
  const result =
    process.platform === "darwin"
      ? action === "stop"
        ? run("launchctl", ["kill", "SIGTERM", `${launchDomain()}/${LABEL}`])
        : run("launchctl", [
            "kickstart",
            ...(action === "restart" ? ["-k"] : []),
            `${launchDomain()}/${LABEL}`,
          ])
      : run("systemctl", ["--user", action, UNIT]);
  if (!result.ok && action !== "stop")
    throw new Error(result.output || `Could not ${action} Glade.`);
}
