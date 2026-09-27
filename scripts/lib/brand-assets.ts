import type { GladePackagedDesktopFlavor } from "@glade/shared/desktopIdentity";

export const BRAND_ASSET_PATHS = {
  productionMacIconPng: "assets/prod/black-macos-1024.png",
  // Icon Composer source for the macOS 26 bundle icon. Only a layered ".icon"
  // asset gets the Liquid Glass material; a flat ICNS/PNG never does.
  productionMacIconComposer: "assets/prod/Glade.icon",
  productionMacCompiledIconCatalog: "assets/prod/Glade-Assets.car",
  productionMacLegacyIconPng: "assets/prod/black-macos-legacy-1024.png",
  productionLinuxIconPng: "assets/prod/black-universal-1024.png",
  productionWindowsIconIco: "assets/prod/glade-black-windows.ico",
  productionWebFaviconIco: "assets/prod/glade-black-web-favicon.ico",
  productionWebFavicon16Png: "assets/prod/glade-black-web-favicon-16x16.png",
  productionWebFavicon32Png: "assets/prod/glade-black-web-favicon-32x32.png",
  productionWebAppleTouchIconPng: "assets/prod/glade-black-web-apple-touch-180.png",
  developmentWindowsIconIco: "assets/dev/blueprint-windows.ico",
  developmentWebFaviconIco: "assets/dev/blueprint-web-favicon.ico",
  developmentWebFavicon16Png: "assets/dev/blueprint-web-favicon-16x16.png",
  developmentWebFavicon32Png: "assets/dev/blueprint-web-favicon-32x32.png",
  developmentWebAppleTouchIconPng: "assets/dev/blueprint-web-apple-touch-180.png",
} as const;

export type DesktopBuildFlavor = GladePackagedDesktopFlavor;

export interface DesktopIconAssetPaths {
  readonly macIconPng: string;
  readonly macIconComposer: string;
  readonly macLegacyIconPng: string;
  /** Dark-appearance dock icon; absent flavors keep their inherited resource. */
  readonly macLegacyDarkIconPng?: string;
  readonly linuxIconPng: string;
  readonly windowsIconIco: string;
}

/** Packaged Glade builds use the production artwork. */
export function desktopIconAssetPaths(flavor: DesktopBuildFlavor): DesktopIconAssetPaths {
  if (flavor !== "production") {
    throw new Error(`Unsupported Glade packaged flavor: ${flavor}`);
  }
  return {
    macIconPng: BRAND_ASSET_PATHS.productionMacIconPng,
    macIconComposer: BRAND_ASSET_PATHS.productionMacIconComposer,
    macLegacyIconPng: BRAND_ASSET_PATHS.productionMacLegacyIconPng,
    linuxIconPng: BRAND_ASSET_PATHS.productionLinuxIconPng,
    windowsIconIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
  };
}

export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

export const DEVELOPMENT_ICON_OVERRIDES: ReadonlyArray<IconOverride> = [
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    targetRelativePath: "dist/client/favicon.ico",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    targetRelativePath: "dist/client/favicon-16x16.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    targetRelativePath: "dist/client/favicon-32x32.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
    targetRelativePath: "dist/client/apple-touch-icon.png",
  },
];

export const PUBLISH_ICON_OVERRIDES: ReadonlyArray<IconOverride> = [
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconIco,
    targetRelativePath: "dist/client/favicon.ico",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    targetRelativePath: "dist/client/favicon-16x16.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    targetRelativePath: "dist/client/favicon-32x32.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
    targetRelativePath: "dist/client/apple-touch-icon.png",
  },
];

/** Favicon overrides for a production package. */
export function publishIconOverrides(flavor: DesktopBuildFlavor): ReadonlyArray<IconOverride> {
  if (flavor !== "production") {
    throw new Error(`Unsupported Glade packaged flavor: ${flavor}`);
  }
  return PUBLISH_ICON_OVERRIDES;
}
