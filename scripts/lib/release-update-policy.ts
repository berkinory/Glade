import { constants, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const RELEASE_CHANNEL = "glade";

function copyChannelManifests(
  assetDirectory: string,
  sourceNames: readonly string[],
  destinationNames: readonly string[],
): void {
  const existing = destinationNames.filter((name) => existsSync(resolve(assetDirectory, name)));
  if (existing.length > 0) {
    throw new Error(`Refusing to overwrite existing update manifest: ${existing.join(", ")}`);
  }
  for (const [index, sourceName] of sourceNames.entries()) {
    const destinationName = destinationNames[index];
    if (!destinationName) throw new Error(`Missing channel manifest mapping for ${sourceName}.`);
    copyFileSync(
      resolve(assetDirectory, sourceName),
      resolve(assetDirectory, destinationName),
      constants.COPYFILE_EXCL,
    );
  }
}

interface MacManifest {
  readonly source: string;
  readonly version: string;
  readonly fileBlock: string;
}

function readMacManifest(source: string, arch: "arm64" | "x64"): MacManifest {
  const version = /^version: (\d+\.\d+\.\d+)$/m.exec(source)?.[1];
  const fileBlock = /^  - url: ([^\n]+)\n    sha512: ([^\n]+)\n    size: (\d+)\n/m.exec(source);
  const path = /^path: ([^\n]+)$/m.exec(source)?.[1];
  const topLevelSha = /^sha512: ([^\n]+)$/m.exec(source)?.[1];
  if (
    !version ||
    !fileBlock ||
    fileBlock[1] !== `Glade-${version}-macOS-${arch}.zip` ||
    !/^[A-Za-z0-9+/]{86}==$/.test(fileBlock[2] ?? "") ||
    !Number.isSafeInteger(Number(fileBlock[3])) ||
    path !== fileBlock[1] ||
    topLevelSha !== fileBlock[2] ||
    (source.match(/^  - url:/gm)?.length ?? 0) !== 1
  ) {
    throw new Error(`Invalid macOS ${arch} update manifest.`);
  }
  return { source, version, fileBlock: fileBlock[0] };
}

export function prepareReleaseUpdateManifests(assetDirectory: string): readonly string[] {
  const macSources = ["latest-mac-arm64.yml", "latest-mac-x64.yml"];
  const macPaths = macSources.map((name) => resolve(assetDirectory, name));
  if (macPaths.some((path) => !existsSync(path))) {
    throw new Error("Release is missing an architecture-specific macOS update manifest.");
  }
  const manifests = macPaths.map((path, index) =>
    readMacManifest(readFileSync(path, "utf8"), index === 0 ? "arm64" : "x64"),
  );
  const [arm64, x64] = manifests;
  if (!arm64 || !x64 || arm64.version !== x64.version) {
    throw new Error("macOS update manifests have different versions.");
  }
  const macDestination = resolve(assetDirectory, `${RELEASE_CHANNEL}-mac.yml`);
  writeFileSync(
    macDestination,
    arm64.source.replace(arm64.fileBlock, `${arm64.fileBlock}${x64.fileBlock}`),
    { flag: "wx" },
  );
  const otherSources = ["latest.yml", "latest-linux.yml"];
  copyChannelManifests(
    assetDirectory,
    otherSources,
    otherSources.map((name) => name.replace("latest", RELEASE_CHANNEL)),
  );
  return [
    ...macSources,
    ...otherSources,
    `${RELEASE_CHANNEL}-mac.yml`,
    "glade.yml",
    "glade-linux.yml",
  ];
}
