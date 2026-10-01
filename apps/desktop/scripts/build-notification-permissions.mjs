import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import headers from "node-api-headers";

const desktopDirectory = fileURLToPath(new URL("..", import.meta.url));

export function buildNotificationPermissions({ arch = process.arch, output } = {}) {
  if (process.platform !== "darwin") return;
  const outputPath =
    output ?? resolve(desktopDirectory, "native-dist/notification-permissions.node");
  const architectures =
    arch === "universal" ? ["arm64", "x86_64"] : [arch === "x64" ? "x86_64" : arch];
  if (architectures.some((value) => !["arm64", "x86_64"].includes(value))) {
    throw new Error(`Unsupported notification module architecture: ${arch}`);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  const result = spawnSync(
    "xcrun",
    [
      "clang++",
      "-std=c++17",
      "-fobjc-arc",
      "-fblocks",
      "-shared",
      "-undefined",
      "dynamic_lookup",
      "-mmacosx-version-min=12.3",
      ...architectures.flatMap((value) => ["-arch", value]),
      "-I",
      headers.include_dir,
      "-framework",
      "Foundation",
      "-framework",
      "UserNotifications",
      resolve(desktopDirectory, "native/notifications/permissions.mm"),
      "-o",
      outputPath,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("Could not build notification permissions module.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildNotificationPermissions({ arch: process.argv[2], output: process.argv[3] });
}
