import { fileURLToPath } from "node:url";

import type { GladePackagedDesktopFlavor } from "@glade/shared/platform/desktopIdentity";

import {
  createDesktopBundleFilePatterns,
  preserveDependencyDiagnostics,
} from "./desktop-bundle-files.ts";

const MICROPHONE_USAGE_DESCRIPTION =
  "Glade needs microphone access so you can record voice notes and transcribe them into the chat composer.";
const COMPUTER_USE_ACCESSIBILITY_DESCRIPTION =
  "Glade controls the apps and windows you allow for Computer Use.";
const COMPUTER_USE_SCREEN_CAPTURE_DESCRIPTION =
  "Glade captures the windows you allow for Computer Use.";
const MAC_ENTITLEMENTS_PATH = "apps/desktop/resources/entitlements.mac.plist";
const MAC_INHERITED_ENTITLEMENTS_PATH = "apps/desktop/resources/entitlements.mac.inherit.plist";
const WINDOWS_INSTALLER_GUID = "5ae5e85a-0788-48c2-ab48-b8fd29cfc1e1";

export const MAC_ICON_ASSET_NAME = "Glade";
export const MAC_ICON_COMPOSER_DEPLOYMENT_TARGET = "26.0";
const MAC_ICON_ASSETS_CAR_STAGE_PATH = "apps/desktop/resources/Assets.car";
const MAC_ICON_ASSETS_CAR_BUNDLE_PATH = "Resources/Assets.car";
const MAC_DMG_ICON_PATH = "icon.icns";
const NODE_PTY_ASAR_UNPACK_GLOBS = ["node_modules/node-pty/**"] as const;
// The Cua SDK passes dlopen a library path next to its own files, so it runs from app.asar.unpacked.
const CUA_SDK_ASAR_UNPACK_GLOBS = ["node_modules/@trycua/**", "node_modules/@ubjs/**"] as const;
// scripts/fetch-cua-driver.mjs places the build host's verified executable here; it ships outside
// ASAR so it keeps its executable bit and code signature.
const CUA_DRIVER_STAGE_PATH = "apps/desktop/resources/cua-driver";
const CUA_DRIVER_MAC_BUNDLE_PATH = "Contents/Resources/cua-driver/darwin-universal/cua-driver";

export interface DesktopPlatformBuildConfig {
  readonly afterSign?: string;
  readonly afterPack?: string;
  readonly asarUnpack?: ReadonlyArray<string>;
  readonly dmg?: Record<string, unknown>;
  readonly extraFiles?: ReadonlyArray<Record<string, string>>;
  readonly extraResources?: ReadonlyArray<Record<string, string>>;
  readonly files?: ReadonlyArray<string>;
  readonly linux?: Record<string, unknown>;
  readonly mac?: Record<string, unknown>;
  readonly npmRebuild?: boolean;
  readonly nsis?: Record<string, unknown>;
  readonly win?: Record<string, unknown>;
}

export interface CreateDesktopPlatformBuildConfigInput {
  readonly platform: "linux" | "mac" | "win";
  readonly target: string;
  readonly signed?: boolean;
  // Seal isolated local bundles without selecting a release certificate.
  readonly adHocSign?: boolean;
  readonly windowsAzureSignOptions?: Record<string, string>;
  readonly flavor?: GladePackagedDesktopFlavor | undefined;
}

export interface DesktopNativeBuildHostInput {
  readonly arch: "arm64" | "x64" | "universal";
  readonly hostArch: string;
  readonly hostPlatform: NodeJS.Platform;
  readonly platform: "linux" | "mac" | "win";
}

export function validateDesktopNativeBuildHost(input: DesktopNativeBuildHostInput): string | null {
  if (input.platform === "mac" && input.hostPlatform !== "darwin") {
    return [
      "macOS desktop artifacts include the native notification permission module.",
      `Build mac/${input.arch} on macOS so the module can be compiled and signed.`,
      `Current host is ${input.hostPlatform}/${input.hostArch}.`,
    ].join(" ");
  }
  if (input.platform !== "linux") return null;
  if (input.arch === "universal") {
    return "Linux desktop artifacts support x64 or arm64 builds, not universal builds.";
  }
  if (input.hostPlatform === "linux" && input.hostArch === input.arch) return null;

  return [
    "Linux desktop artifacts include the native node-pty terminal dependency.",
    `Build linux/${input.arch} on a matching Linux host so pty.node and spawn-helper are compiled for Linux.`,
    `Current host is ${input.hostPlatform}/${input.hostArch}.`,
  ].join(" ");
}

export function createDesktopPlatformBuildConfig(
  input: CreateDesktopPlatformBuildConfigInput,
): DesktopPlatformBuildConfig {
  const files = createDesktopBundleFilePatterns(input.platform, {
    diagnostics: preserveDependencyDiagnostics(process.env),
  });
  const nativePackaging = {
    asarUnpack: [
      ...NODE_PTY_ASAR_UNPACK_GLOBS,
      ...CUA_SDK_ASAR_UNPACK_GLOBS,
      "apps/desktop/native-dist/*.node",
    ],
    files: [...files, `!${CUA_DRIVER_STAGE_PATH}/**`],
    extraResources: [{ from: CUA_DRIVER_STAGE_PATH, to: "cua-driver" }],
  };

  if (input.platform === "mac") {
    const mac = {
      target: input.target === "dmg" ? [input.target, "zip"] : [input.target],
      icon: MAC_DMG_ICON_PATH,
      category: "public.app-category.developer-tools",
      hardenedRuntime: input.signed === true,

      notarize: false,

      ...(input.adHocSign === true && input.signed !== true
        ? { identity: "-", timestamp: "none" }
        : {}),
      entitlements: MAC_ENTITLEMENTS_PATH,
      entitlementsInherit: MAC_INHERITED_ENTITLEMENTS_PATH,
      // Signed with the app identity before the app itself, so the driver runs under Glade's
      // signature and its TCC grants.
      binaries: [CUA_DRIVER_MAC_BUNDLE_PATH],
      x64ArchFiles:
        "Contents/{Resources/cua-driver/**,Resources/app.asar.unpacked/node_modules/**/darwin-*/**,Resources/app.asar.unpacked/node_modules/**/*-darwin-*/**}",
      extendInfo: {
        NSMicrophoneUsageDescription: MICROPHONE_USAGE_DESCRIPTION,
        NSAccessibilityUsageDescription: COMPUTER_USE_ACCESSIBILITY_DESCRIPTION,
        NSScreenCaptureUsageDescription: COMPUTER_USE_SCREEN_CAPTURE_DESCRIPTION,
        CFBundleIconName: MAC_ICON_ASSET_NAME,
      },
    } satisfies Record<string, unknown>;

    return {
      ...nativePackaging,
      ...(input.signed === true
        ? {
            afterPack: fileURLToPath(new URL("./mac-after-pack.cjs", import.meta.url)),
            afterSign: fileURLToPath(new URL("./mac-after-sign.cjs", import.meta.url)),
          }
        : {}),
      dmg: {
        background: "apps/desktop/resources/dmgly/assets/dmg-background.png",
        window: { width: 642, height: 406 },
        iconSize: 128,
        contents: [
          { x: 172, y: 135, type: "file" },
          { x: 514, y: 241, type: "link", path: "/Applications" },
        ],
        sign: input.signed === true,

        writeUpdateInfo: false,
      },
      files: [...nativePackaging.files, "apps/desktop/native-dist/*.node"],
      extraFiles: [
        {
          from: MAC_ICON_ASSETS_CAR_STAGE_PATH,
          to: MAC_ICON_ASSETS_CAR_BUNDLE_PATH,
        },
      ],
      mac,
    };
  }

  if (input.platform === "linux") {
    return {
      ...nativePackaging,
      linux: {
        target: [input.target],
        executableName: "glade",
        icon: "icon.png",
        category: "Development",
        desktop: {
          entry: {
            StartupWMClass: "glade",
          },
        },
      },
    };
  }

  return {
    ...nativePackaging,
    // Every Windows native dependency is N-API with a prebuild (node-pty, the Cua SDK) or an
    // optional accelerator (msgpackr-extract has no win32-arm64 prebuild and falls back to
    // JavaScript), so an Electron rebuild only adds an MSVC dependency and breaks cross-builds.
    npmRebuild: false,

    nsis: {
      guid: WINDOWS_INSTALLER_GUID,
    },
    win: {
      target: [input.target],
      icon: "icon.ico",
      ...(input.windowsAzureSignOptions
        ? {
            publisherName: input.windowsAzureSignOptions.publisherName,
            azureSignOptions: input.windowsAzureSignOptions,
          }
        : {}),
    },
  };
}
