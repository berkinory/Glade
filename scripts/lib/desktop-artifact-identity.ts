import {
  gladeDesktopIdentity,
  type GladePackagedDesktopFlavor,
} from "@glade/shared/platform/desktopIdentity";

export function createDesktopArtifactIdentity(input: {
  readonly platform: "mac" | "linux" | "win";
  readonly flavor: GladePackagedDesktopFlavor;
}) {
  if (input.flavor !== "production") {
    throw new Error("Glade packages only production. Use bun run dev for development.");
  }
  const identity = gladeDesktopIdentity(input.flavor);
  const platformName = { mac: "macOS", linux: "Linux", win: "Windows" }[input.platform];
  const suffix = input.flavor === "production" ? "" : `-${input.flavor}`;
  return {
    identity,
    packageMetadata: {
      name: `glade-desktop${suffix}`,
      productName: identity.displayName,
      gladeDesktopFlavor: input.flavor,
    },
    buildConfig: {
      appId: identity.bundleId,
      productName: identity.displayName,
      artifactName: `${identity.displayName.replaceAll(" ", "-")}-\${version}-${platformName}-\${arch}.\${ext}`,
      ...(input.flavor !== "production"
        ? { protocols: [{ name: identity.displayName, schemes: [identity.scheme] }] }
        : {}),
    },
    releaseDirectoryName: `release${suffix}`,
  };
}
