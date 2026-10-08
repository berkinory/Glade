#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  createReadStream,
  constants,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";

import {
  remoteServerBundleName,
  type RemoteServerTarget,
} from "@glade/shared/remote/remoteServerBundle";

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
// The server bundle the desktop installs on SSH hosts, with the checksum file it verifies.
const remoteServerFiles = (target: RemoteServerTarget) => {
  const archive = `${remoteServerBundleName(version, target)}.tar.gz`;
  return [archive, `${archive}.sha256`] as const;
};
const platforms = [
  {
    id: "mac-arm64",
    platform: "mac",
    arch: "arm64",
    files: [
      `Glade-${version}-macOS-arm64.dmg`,
      `Glade-${version}-macOS-arm64.zip`,
      "latest-mac-arm64.yml",
      ...remoteServerFiles("darwin-arm64"),
    ],
    manifest: "latest-mac-arm64.yml",
    download: `Glade-${version}-macOS-arm64.zip`,
    signing: publish ? "verified" : "unsigned-build-only",
  },
  {
    id: "mac-x64",
    platform: "mac",
    arch: "x64",
    files: [
      `Glade-${version}-macOS-x64.dmg`,
      `Glade-${version}-macOS-x64.zip`,
      "latest-mac-x64.yml",
      ...remoteServerFiles("darwin-x64"),
    ],
    manifest: "latest-mac-x64.yml",
    download: `Glade-${version}-macOS-x64.zip`,
    signing: publish ? "verified" : "unsigned-build-only",
  },
  {
    id: "linux-x64",
    platform: "linux",
    arch: "x64",
    files: [
      `Glade-${version}-Linux-x86_64.AppImage`,
      "latest-linux.yml",
      ...remoteServerFiles("linux-x64"),
    ],
    manifest: "latest-linux.yml",
    download: `Glade-${version}-Linux-x86_64.AppImage`,
    signing: "not-applicable",
  },
  {
    id: "win-x64",
    platform: "win",
    arch: "x64",
    files: [`Glade-${version}-Windows-x64.exe`, "latest.yml"],
    manifest: "latest.yml",
    download: `Glade-${version}-Windows-x64.exe`,
    signing: publish ? "unsigned-explicit-release" : "unsigned-build-only",
  },
] as const;

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function releaseNotes(checksums: readonly string[]): string {
  const lines = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line === `## ${version}` || line.startsWith(`## ${version} `),
  );
  if (start < 0) throw new Error(`CHANGELOG.md has no ${version} section.`);
  let end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  if (end < 0) end = lines.length;
  const notes = lines.slice(start, end).join("\n").trim();
  if (!notes) throw new Error("Release notes are empty.");
  const downloads = [
    ["macOS (Apple Silicon, arm64)", `Glade-${version}-macOS-arm64.dmg`],
    ["macOS (Intel)", `Glade-${version}-macOS-x64.dmg`],
    ["Linux (x64)", `Glade-${version}-Linux-x86_64.AppImage`],
    ["Windows (x64)", `Glade-${version}-Windows-x64.exe`],
  ] as const;
  const links = downloads.map(
    ([label, file]) =>
      `- **${label}:** [${file}](https://github.com/berkinory/Glade/releases/download/v${version}/${file})`,
  );
  return `## Downloads\n\n${links.join("\n")}\n\n${notes}\n\n## SHA-256\n\n\`\`\`text\n${checksums.join("\n")}\n\`\`\`\n`;
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
  binaries.push(
    ...platform.files.filter((name) => !name.endsWith(".yml") && !name.endsWith(".sha256")),
  );
}

if (rawEntries.length !== expectedRaw.size || rawEntries.some((name) => !expectedRaw.has(name))) {
  throw new Error("Downloaded release artifacts are incomplete or contain unexpected files.");
}

mkdirSync(destination, { recursive: true });
if (readdirSync(destination).length !== 0) throw new Error("Release destination must be empty.");
for (const name of rawEntries) {
  if (name.endsWith(".provenance.json")) continue;
  copyFileSync(join(raw, name), join(destination, name), constants.COPYFILE_EXCL);
}
const manifests = prepareReleaseUpdateManifests(destination);
for (const name of manifests.filter((name) => name.startsWith("latest"))) {
  unlinkSync(join(destination, name));
}

const binaryHashes = await Promise.all(
  binaries.toSorted().map(async (name) => `${await sha256(join(destination, name))}  ${name}`),
);
writeFileSync(join(dirname(destination), "release-notes.md"), releaseNotes(binaryHashes), {
  flag: "wx",
});
console.log(
  `Verified ${platforms.length} platforms and assembled ${readdirSync(destination).length} release assets.`,
);
