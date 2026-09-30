#!/usr/bin/env bun
// Standalone hosts authenticate with the shared capability. Native input stays closed without
// verified drain support; browser mutations also require a global Escape adapter. Passive
// observations remain available.

import { randomBytes } from "node:crypto";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { CuaDriverHost, sweepOrphanedCuaDrivers } from "./computer/cua/cuaDriverHost";
import { clearStaleCuaHostSocket } from "./computer/cua/cuaHostSocket";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(message: string): never {
  console.error(`cua-driver-host: ${message}`);
  console.error(
    "usage: cua-driver-host --driver <binary-or-bundle-dir> " +
      "[--socket <unix-path|\\\\.\\pipe\\name>] [--capability-file <path>]",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const driverOption = option("--driver") ?? process.env.GLADE_CUA_DRIVER;
  if (!driverOption) usage("--driver is required (provisioned cua-driver binary or bundle dir).");

  let binaryPath = driverOption;
  if ((await stat(driverOption).catch(() => undefined))?.isDirectory()) {
    binaryPath = join(driverOption, process.platform === "win32" ? "cua-driver.exe" : "cua-driver");
  }
  await access(binaryPath).catch(() => usage(`driver not found or not readable: ${binaryPath}`));

  // The capability is the authority boundary on this socket — it must never travel through argv,
  // which every process on the machine can read.
  const capabilityFile = option("--capability-file");
  let capability = process.env.GLADE_CUA_HOST_CAPABILITY?.trim() ?? "";
  let capabilitySource = "environment";
  if (!capability && capabilityFile) {
    capability = (await readFile(capabilityFile, "utf8").catch(() => "")).trim();
    capabilitySource = capabilityFile;
  }
  if (!capability) {
    capability = randomBytes(32).toString("base64url");
    if (capabilityFile) {
      await writeFile(capabilityFile, capability + "\n", { mode: 0o600 });
      capabilitySource = capabilityFile;
    } else {
      capabilitySource = "generated-below";
    }
  }
  if (Buffer.byteLength(capability, "utf8") < 32)
    usage("capability must be at least 32 bytes (GLADE_CUA_HOST_CAPABILITY or --capability-file).");

  const endpoint = option("--socket");
  if (endpoint) await clearStaleCuaHostSocket(endpoint);

  sweepOrphanedCuaDrivers();
  const host = new CuaDriverHost({
    binaryPath,

    bundleId: `glade-cua-standalone-${process.platform}`,
    capability,
    nativeRevision: null,
    ...(process.platform === "linux"
      ? {
          inputMonitorState: () => ({
            ready: false,
            error: "linux_global_escape_unavailable",
          }),
        }
      : {}),
    ...(endpoint ? { hostEndpoint: endpoint } : {}),
    setup: async () => {
      throw new Error(
        `This host cannot request ${process.platform} permissions. Grant the driver host ` +
          "whatever display-server or automation access the platform requires, then retry.",
      );
    },
  });

  const bound = await host.listen();
  const shutdown = async (signal: string) => {
    console.info(`[cua-driver-host] ${signal} received; disposing`);
    try {
      await host.dispose();
      process.exit(0);
    } catch (error) {
      console.error("[cua-driver-host] cleanup failed:", error);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  console.info(`CUA_HOST_ENDPOINT=${bound}`);
  if (capabilitySource === "generated-below") {
    console.info(`CUA_CAPABILITY=${capability}`);
    console.info(
      "[cua-driver-host] generated an ephemeral capability (above). Set it on the server as " +
        "GLADE_BROWSER_HOST_CAPABILITY; it dies with this host.",
    );
  } else {
    console.info(`[cua-driver-host] capability source: ${capabilitySource}`);
  }
  console.info(
    "[cua-driver-host] server wiring: GLADE_CUA_HOST_SOCKET=" +
      bound +
      " GLADE_BROWSER_HOST_CAPABILITY=<capability>",
  );
  console.info(
    `[cua-driver-host] driver: ${basename(binaryPath)} (capabilities checked at handshake)`,
  );
  if (process.platform === "linux")
    console.info(
      "[cua-driver-host] no global Escape adapter: Linux browser observation is available; browser actions are disabled.",
    );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
