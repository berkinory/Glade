import { REMOTE_SERVER_LAUNCH_MARKER } from "@glade/contracts/remote/remoteServer";
import { ensureServer, LaunchError } from "./hostServer";

// Runs on the SSH host under the bundled Node runtime and answers every connect with the host
// server's port and token, starting the server when it is not running.
async function main(): Promise<void> {
  const [command, flag, devUrl] = process.argv.slice(2);
  if (command !== "start" || (flag !== undefined && (flag !== "--dev-url" || !devUrl))) {
    throw new LaunchError("Usage: remoteLauncher start [--dev-url <url>]");
  }
  const launch = await ensureServer(devUrl ?? null);
  process.stdout.write(`${REMOTE_SERVER_LAUNCH_MARKER}${JSON.stringify(launch)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
