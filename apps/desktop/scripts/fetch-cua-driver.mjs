// Downloads the pinned upstream Cua Driver executable for one platform into
// apps/desktop/resources/cua-driver/<artifact>/, verifying the archive and the extracted
// executable against src/computer/cuaRelease.json. Skips the download when a verified copy exists.
// --stage copies the verified executable into <dir>/<artifact>/ for a packaging stage.
//
//   node scripts/fetch-cua-driver.mjs [--platform darwin|linux|win32] [--arch x64|arm64|universal]
//                                     [--stage <dir>]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const release = JSON.parse(
  await readFile(join(desktopDir, "src/computer/cuaRelease.json"), "utf8"),
);

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const platform = option("platform", process.platform);
const arch = option("arch", process.arch);
const stageDir = option("stage", null);
// Mirrors cuaArtifactKey in src/computer/cuaBinary.ts: macOS ships one universal executable.
const key = platform === "darwin" ? "darwin-universal" : `${platform}-${arch}`;
const artifact = release.artifacts[key];
if (!artifact) {
  // A package must not ship without its driver; a dev run on such a host just has no Computer Use.
  const log = stageDir ? console.error : console.log;
  log(`[cua-driver] No pinned Cua Driver build for ${platform}-${arch}; skipping.`);
  process.exit(stageDir ? 1 : 0);
}

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

const targetDir = join(desktopDir, "resources/cua-driver", key);
const target = join(targetDir, artifact.executable);

async function install() {
  const workDir = mkdtempSync(join(tmpdir(), "glade-cua-driver-"));
  try {
    const url = `${release.downloadBaseUrl}/${artifact.archive}`;
    console.log(`[cua-driver] Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
    const archive = join(workDir, artifact.archive);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    const archiveSha = await sha256(archive);
    if (archiveSha !== artifact.archiveSha256) {
      throw new Error(
        `${artifact.archive} has SHA-256 ${archiveSha}, expected ${artifact.archiveSha256}.`,
      );
    }

    // Only the executable: it links no bundled library (otool -L / ldd show system libraries only).
    const extractDir = join(workDir, "extract");
    mkdirSync(extractDir);
    if (artifact.archive.endsWith(".zip") && process.platform === "linux") {
      execFileSync("unzip", ["-q", archive, artifact.executable, "-d", extractDir]);
    } else {
      // bsdtar (macOS, Windows) reads zip archives too. Git Bash puts GNU tar first on
      // Windows, which reads `C:` paths as a remote host, so name the system bsdtar.
      let tar = "tar";
      if (process.platform === "win32") {
        if (!process.env.SystemRoot) throw new Error("SystemRoot is required to locate tar.exe.");
        tar = join(process.env.SystemRoot, "System32", "tar.exe");
      }
      execFileSync(tar, ["-xf", archive, "-C", extractDir, artifact.executable]);
    }
    const extracted = join(extractDir, artifact.executable);
    const executableSha = await sha256(extracted);
    if (executableSha !== artifact.executableSha256) {
      throw new Error(
        `${artifact.executable} has SHA-256 ${executableSha}, expected ${artifact.executableSha256}.`,
      );
    }
    mkdirSync(targetDir, { recursive: true });
    rmSync(target, { force: true });
    copyFileSync(extracted, target);
    chmodSync(target, 0o755);
    console.log(`[cua-driver] Installed ${release.version} ${key} at ${target}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (existsSync(target) && (await sha256(target)) === artifact.executableSha256) {
  console.log(`[cua-driver] ${release.version} ${key} already present.`);
} else {
  await install();
}

if (stageDir) {
  const stagedDir = join(resolve(stageDir), key);
  mkdirSync(stagedDir, { recursive: true });
  copyFileSync(target, join(stagedDir, artifact.executable));
  chmodSync(join(stagedDir, artifact.executable), 0o755);
  console.log(`[cua-driver] Staged ${release.version} ${key} in ${stagedDir}`);
}
