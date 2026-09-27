#!/usr/bin/env node
// Collect one complete, source-matched release from independently built platforms.

import { createHash } from "node:crypto";
import {
  createReadStream,
  constants,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";

import { prepareReleaseUpdateManifests } from "./lib/release-update-policy.ts";

interface ArtifactDigest {
  readonly fileName: string;
  readonly sha256: string;
  readonly size: number;
}

interface PlatformProvenance {
  readonly schemaVersion: 1;
  readonly publication: boolean;
  readonly platform: "mac" | "linux" | "win";
  readonly arch: string;
  readonly version: string;
  readonly source: {
    readonly commit: string;
    readonly tag: string | null;
    readonly lockfileSha256: string;
  };
  readonly signing: { readonly status: string };
  readonly artifacts: readonly ArtifactDigest[];
}

const [rawDirectory, publishDirectory, version, commit, publishFlag] = process.argv.slice(2);
if (
  !rawDirectory ||
  !publishDirectory ||
  !version ||
  !commit ||
  !["true", "false"].includes(publishFlag ?? "")
) {
  throw new Error(
    "Usage: assemble-release-assets.ts <raw-dir> <publish-dir> <version> <commit> <publish:true|false>",
  );
}
if (
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
  !/^[0-9a-f]{40}$/i.test(commit)
) {
  throw new Error("Release version or source commit is invalid.");
}

const raw = resolve(rawDirectory);
const destination = resolve(publishDirectory);
const publish = publishFlag === "true";
if (publish && process.env.GITHUB_REPOSITORY !== "berkinory/Glade") {
  throw new Error("Glade releases may only publish to berkinory/Glade.");
}
const lockfileSha256 = createHash("sha256").update(readFileSync("bun.lock")).digest("hex");
const platforms = [
  {
    id: "mac-universal",
    platform: "mac",
    arch: "universal",
    files: [`Glade-${version}-universal.dmg`, `Glade-${version}-universal.zip`, "latest-mac.yml"],
    manifest: "latest-mac.yml",
    download: `Glade-${version}-universal.zip`,
    signing: publish ? "verified" : "unsigned-build-only",
  },
  {
    id: "linux-x64",
    platform: "linux",
    arch: "x64",
    files: [`Glade-${version}-x86_64.AppImage`, "latest-linux.yml"],
    manifest: "latest-linux.yml",
    download: `Glade-${version}-x86_64.AppImage`,
    signing: "not-applicable",
  },
  {
    id: "win-x64",
    platform: "win",
    arch: "x64",
    files: [`Glade-${version}-x64.exe`, "latest.yml"],
    manifest: "latest.yml",
    download: `Glade-${version}-x64.exe`,
    signing: publish ? "unsigned-explicit-release" : "unsigned-build-only",
  },
] as const;

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function releaseNotes(): string {
  const lines = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line === `## ${version}` || line.startsWith(`## ${version} `),
  );
  if (start < 0) throw new Error(`CHANGELOG.md has no ${version} section.`);
  let end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  if (end < 0) end = lines.length;
  const notes = lines.slice(start, end).join("\n").trim();
  if (!notes) throw new Error("Release notes are empty.");
  return `${notes}\n`;
}

const rawEntries = readdirSync(raw).toSorted();
const expectedRaw = new Set<string>();
const binaries: string[] = [];
let sourceTag: string | null | undefined;

for (const platform of platforms) {
  const provenanceName = `artifact-${platform.platform}-${platform.arch}.provenance.json`;
  expectedRaw.add(provenanceName);
  const provenance = JSON.parse(
    readFileSync(join(raw, provenanceName), "utf8"),
  ) as PlatformProvenance;
  if (
    provenance.schemaVersion !== 1 ||
    provenance.publication !== publish ||
    provenance.platform !== platform.platform ||
    provenance.arch !== platform.arch ||
    provenance.version !== version ||
    provenance.source.commit !== commit.toLowerCase() ||
    provenance.source.lockfileSha256 !== lockfileSha256 ||
    provenance.signing.status !== platform.signing
  ) {
    throw new Error(`${provenanceName} does not match this release source or signing policy.`);
  }
  if (publish && provenance.source.tag !== `v${version}`) {
    throw new Error(`${provenanceName} does not come from the v${version} tag.`);
  }
  if (sourceTag === undefined) sourceTag = provenance.source.tag;
  else if (sourceTag !== provenance.source.tag)
    throw new Error("Platform artifacts have different source tags.");

  const artifactNames = new Set(provenance.artifacts.map((artifact) => artifact.fileName));
  for (const name of platform.files) {
    if (!artifactNames.has(name)) throw new Error(`${provenanceName} is missing ${name}.`);
  }
  const manifest = readFileSync(join(raw, platform.manifest), "utf8");
  if (!manifest.includes(`version: ${version}`) || !manifest.includes(platform.download)) {
    throw new Error(`${platform.manifest} does not describe ${platform.download} at ${version}.`);
  }

  for (const artifact of provenance.artifacts) {
    if (
      !artifact.fileName ||
      artifact.fileName.includes("/") ||
      artifact.fileName.includes("\\") ||
      expectedRaw.has(artifact.fileName)
    ) {
      throw new Error(`Duplicate or invalid release asset: ${artifact.fileName}.`);
    }
    expectedRaw.add(artifact.fileName);
    const path = join(raw, artifact.fileName);
    if (
      !statSync(path).isFile() ||
      statSync(path).size !== artifact.size ||
      (await sha256(path)) !== artifact.sha256
    ) {
      throw new Error(`Release asset has changed since verification: ${artifact.fileName}.`);
    }
  }
  binaries.push(...platform.files.filter((name) => !name.endsWith(".yml")));
}

if (rawEntries.length !== expectedRaw.size || rawEntries.some((name) => !expectedRaw.has(name))) {
  throw new Error("Downloaded release artifacts are incomplete or contain unexpected files.");
}

mkdirSync(destination, { recursive: true });
if (readdirSync(destination).length !== 0) throw new Error("Release destination must be empty.");
for (const name of rawEntries)
  copyFileSync(join(raw, name), join(destination, name), constants.COPYFILE_EXCL);
prepareReleaseUpdateManifests(destination);

const binaryHashes = await Promise.all(
  binaries.toSorted().map(async (name) => `${await sha256(join(destination, name))}  ${name}`),
);
writeFileSync(join(destination, "SHA256SUMS.txt"), `${binaryHashes.join("\n")}\n`, { flag: "wx" });
writeFileSync(join(dirname(destination), "release-notes.md"), releaseNotes(), { flag: "wx" });
console.log(
  `Verified ${platforms.length} platforms and assembled ${readdirSync(destination).length} release assets.`,
);
