// FILE: desktopIdentity.ts
// Purpose: Defines the canonical desktop application identity across packaging and runtime.

export const GLADE_DESKTOP_SCHEME = "glade";
export const GLADE_DESKTOP_ORIGIN = `${GLADE_DESKTOP_SCHEME}://app`;
export const GLADE_DESKTOP_ENTRY_URL = `${GLADE_DESKTOP_ORIGIN}/index.html`;
export const GLADE_DESKTOP_UPDATE_CHANNEL = "glade";
export const GLADE_PRODUCTION_BUNDLE_ID = "com.agent.glade";
export const GLADE_DEVELOPMENT_BUNDLE_ID = `${GLADE_PRODUCTION_BUNDLE_ID}.dev`;
/** Display/setup identity of the GUI host; this value does not confer native authority. */
export const GLADE_DESKTOP_BUNDLE_ID_ENV = "GLADE_DESKTOP_BUNDLE_ID";
export const GLADE_SOURCE_DESKTOP_BUILD_MARKER = "glade-source-desktop-build-v2";
export const GLADE_DESKTOP_SMOKE_USER_DATA_ENV = "GLADE_DESKTOP_SMOKE_USER_DATA";

export type GladeDesktopFlavor = "production" | "development";
export const GLADE_PACKAGED_DESKTOP_FLAVORS = ["production"] as const;
export type GladePackagedDesktopFlavor = (typeof GLADE_PACKAGED_DESKTOP_FLAVORS)[number];

export function desktopUpdateChannel(_flavor: GladeDesktopFlavor): string {
  return GLADE_DESKTOP_UPDATE_CHANNEL;
}

export interface GladeDesktopIdentity {
  readonly flavor: GladeDesktopFlavor;
  readonly displayName: string;
  readonly bundleId: string;
  readonly scheme: string;
  readonly origin: string;
  readonly entryUrl: string;
  readonly userDataDirectoryName: string;
  readonly defaultHomeDirectoryName: string;
  readonly usesScriptedUpdates: boolean;
}

export function resolveGladeDesktopFlavor(input: {
  readonly isDevelopment: boolean;
  readonly requestedFlavor?: string | undefined;
  readonly allowDevelopmentOverride?: boolean | undefined;
}): GladeDesktopFlavor {
  const requestedFlavor = input.requestedFlavor?.trim().toLowerCase();
  if (requestedFlavor && !["production", "development"].includes(requestedFlavor)) {
    throw new Error(`Unsupported Glade flavor: ${requestedFlavor}. Use production or development.`);
  }
  if (
    requestedFlavor === "development" &&
    (input.isDevelopment || input.allowDevelopmentOverride === true)
  ) {
    return "development";
  }
  return input.isDevelopment ? "development" : "production";
}

/** Packaged identity is fixed when the artifact is staged, before it is signed. */
export function resolveGladeDesktopRuntimeFlavor(input: {
  readonly isPackaged: boolean;
  readonly isDevelopment: boolean;
  readonly packagedFlavor?: unknown;
  readonly requestedFlavor?: string | undefined;
  readonly allowDevelopmentOverride?: boolean | undefined;
}): GladeDesktopFlavor {
  if (input.isPackaged && input.packagedFlavor !== undefined) {
    const flavor = input.packagedFlavor;
    if (flavor === "production") {
      return flavor;
    }
    throw new Error("The packaged Glade desktop flavor is invalid. Rebuild the application.");
  }
  // Source launchers also use an app bundle on macOS. Their build marker keeps
  // the existing environment-based routing, while legacy packaged apps remain
  // Stable even when a developer shell happens to export a different flavor.
  if (input.isPackaged && input.allowDevelopmentOverride !== true) {
    return "production";
  }
  return resolveGladeDesktopFlavor(input);
}

export function canOverrideDesktopSmokeUserData(input: {
  readonly packagedFlavor?: unknown;
  readonly sourceBuildMarker?: string | undefined;
}): boolean {
  return (
    input.packagedFlavor === undefined &&
    input.sourceBuildMarker === GLADE_SOURCE_DESKTOP_BUILD_MARKER
  );
}

export function gladeDesktopIdentity(flavor: GladeDesktopFlavor): GladeDesktopIdentity {
  if (flavor === "development") {
    return {
      flavor,
      displayName: "Glade (Dev)",
      bundleId: GLADE_DEVELOPMENT_BUNDLE_ID,
      scheme: GLADE_DESKTOP_SCHEME,
      origin: GLADE_DESKTOP_ORIGIN,
      entryUrl: GLADE_DESKTOP_ENTRY_URL,
      userDataDirectoryName: "glade-dev",
      defaultHomeDirectoryName: ".glade-dev",
      usesScriptedUpdates: false,
    };
  }
  return {
    flavor,
    displayName: "Glade",
    bundleId: GLADE_PRODUCTION_BUNDLE_ID,
    scheme: GLADE_DESKTOP_SCHEME,
    origin: GLADE_DESKTOP_ORIGIN,
    entryUrl: GLADE_DESKTOP_ENTRY_URL,
    userDataDirectoryName: "glade",
    defaultHomeDirectoryName: ".glade",
    usesScriptedUpdates: false,
  };
}
