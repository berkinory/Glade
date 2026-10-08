#!/usr/bin/env node
// Builds the self-contained server bundle the desktop installs on SSH hosts: the pinned official
// Node.js runtime, apps/server/dist and its production node_modules. Linux native modules are
// compiled and smoke-tested inside a Debian bullseye container so the bundle runs on any host
// with glibc 2.31 or newer, whatever machine builds it.
//
//   node scripts/build-remote-server.ts --target linux-x64 [--version 0.2.1]
//                                       [--output-dir release/remote] [--skip-smoke]
//
// Requires apps/server/dist (bun run --cwd apps/server build:dev), bun, tar and, for Linux
// targets, docker.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import {
  REMOTE_SERVER_NODE_PATH,
  REMOTE_SERVER_TARGETS,
  remoteServerBundleName,
  type RemoteServerTarget,
} from "@glade/shared/remote/remoteServerBundle";

import rootPackageJson from "../package.json" with { type: "json" };
import serverPackageJson from "../apps/server/package.json" with { type: "json" };
import {
  RELEASE_LOCKFILE_PATH,
  RELEASE_PATCHES_PATH,
  RELEASE_WORKSPACE_MANIFEST_PATHS,
} from "./lib/release-workspace-manifests.ts";
import { findUnappliedStagedPatch } from "./lib/staged-patches.ts";

// glibc 2.31 (Debian 11, Ubuntu 20.04) is the oldest Linux the bundle supports; official Node 24
// binaries need 2.28. node-pty is an N-API addon, so the build Node version does not matter.
const LINUX_BUILD_IMAGE = "node:22-bullseye";

// Type declarations and source maps are a sixth of the archive and nothing reads them at runtime.
const DEV_ONLY_FILE = /\.(d\.[cm]?ts|[cm]?js\.map|d\.[cm]?ts\.map)$/u;

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimePin = JSON.parse(
  await readFile(join(repoRoot, "scripts/remote-node-runtime.json"), "utf8"),
) as {
  readonly version: string;
  readonly downloadBaseUrl: string;
  readonly artifacts: Record<RemoteServerTarget, { archive: string; archiveSha256: string }>;
};

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`[remote-server] ${message}`);
  process.exit(1);
}

function run(command: string, args: ReadonlyArray<string>, cwd = repoRoot): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited with ${result.status}`);
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

const requestedTarget = option("target") as RemoteServerTarget | undefined;
if (!requestedTarget || !REMOTE_SERVER_TARGETS.includes(requestedTarget)) {
  fail(`--target must be one of ${REMOTE_SERVER_TARGETS.join(", ")}`);
}
const target: RemoteServerTarget = requestedTarget;
const [targetOs, targetArch] = target.split("-") as ["linux" | "darwin", "x64" | "arm64"];
const version = option("version") ?? serverPackageJson.version;
const outputDir = resolve(option("output-dir") ?? join(repoRoot, "release/remote"));
const skipSmoke = process.argv.includes("--skip-smoke");
const serverDist = join(repoRoot, "apps/server/dist");
for (const entry of ["index.mjs", "remoteLauncher.mjs", "runtimeDependencySmoke.mjs"]) {
  if (!existsSync(join(serverDist, entry))) {
    fail(`apps/server/dist/${entry} is missing; build the server first.`);
  }
}

const bundleName = remoteServerBundleName(version, target);
const workDir = mkdtempSync(join(tmpdir(), "glade-remote-server-"));
const installDir = join(workDir, "install");
const bundleDir = join(workDir, bundleName);

try {
  console.log(`[remote-server] Installing production dependencies for ${target}...`);
  for (const relativePath of [...RELEASE_WORKSPACE_MANIFEST_PATHS, RELEASE_LOCKFILE_PATH]) {
    mkdirSync(join(installDir, relativePath, ".."), { recursive: true });
    copyFileSync(join(repoRoot, relativePath), join(installDir, relativePath));
  }
  cpSync(join(repoRoot, RELEASE_PATCHES_PATH), join(installDir, RELEASE_PATCHES_PATH), {
    recursive: true,
  });
  run(
    "bun",
    [
      "install",
      "--frozen-lockfile",
      "--production",
      "--filter",
      serverPackageJson.name,
      "--ignore-scripts",
      "--linker",
      "hoisted",
      `--os=${targetOs}`,
      `--cpu=${targetArch}`,
    ],
    installDir,
  );
  const patchProblem = findUnappliedStagedPatch({
    repoRoot,
    stageDir: installDir,
    patchedDependencies: rootPackageJson.patchedDependencies ?? {},
    requireInstalled: false,
  });
  if (patchProblem) fail(patchProblem);

  mkdirSync(bundleDir);
  renameSync(join(installDir, "node_modules"), join(bundleDir, "node_modules"));
  pruneNodeModules(join(bundleDir, "node_modules"));
  cpSync(serverDist, join(bundleDir, "dist"), {
    recursive: true,
    filter: (source) => !source.startsWith(join(serverDist, "client")) && !source.endsWith(".map"),
  });
  writeFileSync(
    join(bundleDir, "package.json"),
    `${JSON.stringify({ name: "glade-remote-server", version, private: true, type: "module" }, null, 2)}\n`,
  );

  if (targetOs === "linux") {
    console.log("[remote-server] Building node-pty in the Linux build container...");
    runInLinuxContainer(
      "cd /bundle && npm rebuild node-pty --foreground-scripts && rm -rf node_modules/node-pty/build/Release/obj.target node_modules/node-pty/build/Release/.deps",
    );
  }

  await installNodeRuntime();

  if (skipSmoke) {
    console.log("[remote-server] Skipping smoke tests.");
  } else if (targetOs === "linux") {
    runInLinuxContainer(smokeCommand("/bundle", "/scripts"));
  } else if (target === `${process.platform}-${process.arch}`) {
    run("sh", ["-c", smokeCommand(bundleDir, join(repoRoot, "scripts"))]);
  } else {
    console.log(`[remote-server] Cannot run ${target} smoke tests on this host; skipping.`);
  }

  mkdirSync(outputDir, { recursive: true });
  const archive = join(outputDir, `${bundleName}.tar.gz`);
  // macOS tar otherwise records extended attributes (com.apple.provenance) that GNU tar on the host
  // warns about once per file.
  run("tar", ["--no-xattrs", "-czf", archive, "-C", workDir, bundleName]);
  const digest = await sha256(archive);
  writeFileSync(`${archive}.sha256`, `${digest}  ${bundleName}.tar.gz\n`);
  console.log(`[remote-server] Wrote ${archive}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

function pruneNodeModules(nodeModules: string): void {
  // The server runs the user's own provider CLIs, so the SDKs' bundled binaries are dead weight.
  const anthropic = join(nodeModules, "@anthropic-ai");
  for (const entry of readdirSync(anthropic)) {
    if (entry.startsWith("claude-agent-sdk-")) rmSync(join(anthropic, entry), { recursive: true });
  }
  rmSync(join(nodeModules, "patchright-core"), { recursive: true, force: true });
  rmSync(join(nodeModules, "@types"), { recursive: true, force: true });
  removeDevOnlyFiles(nodeModules);
  const prebuilds = join(nodeModules, "node-pty/prebuilds");
  if (existsSync(prebuilds)) {
    for (const entry of readdirSync(prebuilds)) {
      if (entry !== target) rmSync(join(prebuilds, entry), { recursive: true });
    }
    // Installing with --ignore-scripts skips node-pty's step that marks its helper executable.
    const spawnHelper = join(prebuilds, target, "spawn-helper");
    if (existsSync(spawnHelper)) chmodSync(spawnHelper, 0o755);
  }
}

function removeDevOnlyFiles(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) removeDevOnlyFiles(path);
    else if (entry.isFile() && DEV_ONLY_FILE.test(entry.name)) rmSync(path);
  }
}

function runInLinuxContainer(script: string): void {
  run("docker", [
    "run",
    "--rm",
    "--platform",
    `linux/${targetArch === "x64" ? "amd64" : "arm64"}`,
    "-v",
    `${bundleDir}:/bundle`,
    "-v",
    `${join(repoRoot, "scripts")}:/scripts:ro`,
    LINUX_BUILD_IMAGE,
    "sh",
    "-ec",
    script,
  ]);
}

function smokeCommand(bundle: string, scripts: string): string {
  const node = `${bundle}/${REMOTE_SERVER_NODE_PATH}`;
  return [
    `${node} ${bundle}/dist/runtimeDependencySmoke.mjs`,
    `GLADE_NODE_PTY_SMOKE_REQUIRE_ROOT=${bundle} ${node} ${scripts}/node-pty-smoke.mjs`,
  ].join(" && ");
}

async function installNodeRuntime(): Promise<void> {
  const artifact = runtimePin.artifacts[target];
  const cacheDir = join(repoRoot, "node_modules/.cache/glade-remote-node");
  const archive = join(cacheDir, artifact.archive);
  mkdirSync(cacheDir, { recursive: true });
  if (!existsSync(archive) || (await sha256(archive)) !== artifact.archiveSha256) {
    console.log(`[remote-server] Downloading ${artifact.archive}...`);
    const response = await fetch(`${runtimePin.downloadBaseUrl}/${artifact.archive}`);
    if (!response.ok || !response.body) fail(`Node.js download failed: ${response.status}`);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    const digest = await sha256(archive);
    if (digest !== artifact.archiveSha256) {
      rmSync(archive);
      fail(`${artifact.archive} has SHA-256 ${digest}, expected ${artifact.archiveSha256}`);
    }
  }
  const archiveRoot = artifact.archive.replace(/\.tar\.gz$/u, "");
  const extractDir = join(workDir, "node");
  mkdirSync(extractDir);
  run("tar", [
    "-xzf",
    archive,
    "-C",
    extractDir,
    `${archiveRoot}/bin/node`,
    `${archiveRoot}/LICENSE`,
  ]);
  mkdirSync(join(bundleDir, "bin"));
  renameSync(join(extractDir, archiveRoot, "bin/node"), join(bundleDir, REMOTE_SERVER_NODE_PATH));
  chmodSync(join(bundleDir, REMOTE_SERVER_NODE_PATH), 0o755);
  renameSync(join(extractDir, archiveRoot, "LICENSE"), join(bundleDir, "bin/NODE_LICENSE"));
}
