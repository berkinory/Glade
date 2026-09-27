/** Glade publishes stable versions through GitHub Latest and its dedicated feed. */
import { constants, copyFileSync, existsSync } from "node:fs";
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

export function prepareReleaseUpdateManifests(assetDirectory: string): readonly string[] {
  const sourceNames = ["latest-mac.yml", "latest.yml", "latest-linux.yml"].filter((name) =>
    existsSync(resolve(assetDirectory, name)),
  );
  if (sourceNames.length === 0) throw new Error("Release is missing update manifests.");
  const destinations = sourceNames.map((name) => name.replace("latest", RELEASE_CHANNEL));
  copyChannelManifests(assetDirectory, sourceNames, destinations);
  return [...sourceNames, ...destinations];
}
