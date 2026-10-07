import type { ComputerUnavailableReason } from "@glade/contracts/computer/computerHost";
import { execProcessFile } from "@glade/shared/platform/processRuntime";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import { pipeline } from "node:stream/promises";
import cuaRelease from "./cuaRelease.json";

export type CuaBinary =
  | { readonly ok: true; readonly path: string; readonly version: string }
  | {
      readonly ok: false;
      readonly reason: Extract<
        ComputerUnavailableReason,
        "unsupported_platform" | "binary_missing" | "binary_mismatch"
      >;
      readonly message: string;
    };

type ArtifactKey = keyof typeof cuaRelease.artifacts;

// The macOS release ships one universal executable for both architectures.
function cuaArtifactKey(platform: NodeJS.Platform, arch: string): ArtifactKey | null {
  const key = platform === "darwin" ? "darwin-universal" : `${platform}-${arch}`;
  return Object.hasOwn(cuaRelease.artifacts, key) ? (key as ArtifactKey) : null;
}

async function sha256(path: string): Promise<string> {
  const hash = Crypto.createHash("sha256");
  await pipeline(FS.createReadStream(path), hash);
  return hash.digest("hex");
}

function codesign(args: ReadonlyArray<string>): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execProcessFile(
      "/usr/bin/codesign",
      args,
      { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => resolve({ ok: error === null, output: `${stdout}${stderr}` }),
    );
  });
}

// Ad-hoc signatures report "not set"; two of those must never count as the same team.
const teamIdentifier = (output: string) => {
  const team = /^TeamIdentifier=(.+)$/mu.exec(output)?.[1];
  return team === undefined || team === "not set" ? null : team;
};

// Packaged macOS builds re-sign the executable with Glade's identity after the build verified the
// upstream bytes, so its hash no longer matches the release. There the executable must carry a
// valid signature from the same team as the running app; the app's own seal covers its bytes.
async function signedLikeApp(path: string, appExecutable: string): Promise<boolean> {
  const [valid, executable, app] = await Promise.all([
    codesign(["--verify", "--strict", path]),
    codesign(["-dv", path]),
    codesign(["-dv", appExecutable]),
  ]);
  const team = teamIdentifier(executable.output);
  return valid.ok && team !== null && team === teamIdentifier(app.output);
}

// Packaged apps carry the executable in Resources/cua-driver/<artifact>/ outside ASAR; source runs
// use apps/desktop/resources/cua-driver/<artifact>/, filled by scripts/fetch-cua-driver.mjs. Nothing
// executes it before that check passes.
export async function resolveCuaBinary(input: {
  readonly resourcesDir: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly packaged: boolean;
}): Promise<CuaBinary> {
  const key = cuaArtifactKey(input.platform, input.arch);
  if (!key) {
    return {
      ok: false,
      reason: "unsupported_platform",
      message: `Cua Driver ${cuaRelease.version} has no build for ${input.platform}-${input.arch}.`,
    };
  }
  const artifact = cuaRelease.artifacts[key];
  const path = Path.join(input.resourcesDir, key, artifact.executable);
  if (!FS.existsSync(path)) {
    return {
      ok: false,
      reason: "binary_missing",
      message: `The Cua Driver executable is missing at ${path}. Run apps/desktop/scripts/fetch-cua-driver.mjs.`,
    };
  }
  const verified =
    input.packaged && input.platform === "darwin"
      ? await signedLikeApp(path, process.execPath)
      : (await sha256(path)) === artifact.executableSha256;
  if (!verified) {
    return {
      ok: false,
      reason: "binary_mismatch",
      message: `The Cua Driver executable at ${path} does not match the pinned ${cuaRelease.version} release.`,
    };
  }
  return { ok: true, path, version: cuaRelease.version };
}
