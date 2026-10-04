import {
  canOverrideDesktopSmokeUserData,
  GLADE_DESKTOP_SMOKE_USER_DATA_ENV,
  GLADE_SOURCE_DESKTOP_BUILD_MARKER,
  gladeDesktopIdentity,
  resolveGladeDesktopRuntimeFlavor,
} from "@glade/shared/platform/desktopIdentity";
import { app } from "electron";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import {
  resolveDesktopAppDataBase,
  resolveDesktopUserDataPath,
} from "../storage/desktopUserDataProfile";
import { syncShellEnvironment } from "./lifecycle/syncShellEnvironment";
import { captureStartupBundleIdentity } from "./protocol/bundleSwapDetection";
const requestedSourceBuildMarker = process.env.GLADE_SOURCE_DESKTOP_BUILD_MARKER;
if (
  requestedSourceBuildMarker !== undefined &&
  requestedSourceBuildMarker !== GLADE_SOURCE_DESKTOP_BUILD_MARKER
)
  throw new Error("The source desktop launcher and built main are incompatible. Rebuild Glade.");
export const startupBundleIdentity = captureStartupBundleIdentity();
export const shellEnvironmentSync = syncShellEnvironment();
export const MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH = 16 * 1024 * 1024;
const packagedDesktopFlavor = app.isPackaged
  ? (
      JSON.parse(FS.readFileSync(Path.join(app.getAppPath(), "package.json"), "utf8")) as {
        gladeDesktopFlavor?: unknown;
      }
    ).gladeDesktopFlavor
  : undefined;
const isSourceDesktopBuild =
  requestedSourceBuildMarker === GLADE_SOURCE_DESKTOP_BUILD_MARKER &&
  packagedDesktopFlavor === undefined;
export const isDevelopment =
  (!app.isPackaged || isSourceDesktopBuild) && Boolean(process.env.VITE_DEV_SERVER_URL);
export const desktopFlavor = resolveGladeDesktopRuntimeFlavor({
  isPackaged: app.isPackaged,
  isDevelopment: isDevelopment,
  packagedFlavor: packagedDesktopFlavor,
  requestedFlavor: process.env.GLADE_DESKTOP_FLAVOR,
  allowDevelopmentOverride: isSourceDesktopBuild,
});
export const desktopIdentity = gladeDesktopIdentity(desktopFlavor);
export const BASE_DIR =
  process.env.GLADE_HOME?.trim() ||
  Path.join(OS.homedir(), desktopIdentity.defaultHomeDirectoryName);
export const STATE_DIR = Path.join(BASE_DIR, "userdata");
export const DESKTOP_WINDOW_STATE_PATH = Path.join(STATE_DIR, "desktop-window-state.json");
export const DESKTOP_APP_ICON_PATH = Path.join(STATE_DIR, "desktop-app-icon");
export const DESKTOP_WINDOW_MATERIAL_PATH = Path.join(STATE_DIR, "desktop-window-material.json");

export const DESKTOP_CUSTOM_TITLE_BAR_PATH = Path.join(STATE_DIR, "desktop-custom-title-bar.json");
export const AGENT_CURSOR_PREFERENCE_PATH = Path.join(STATE_DIR, "agent-cursor-colors.json");
export const DESKTOP_SCHEME = desktopIdentity.scheme;
export const ROOT_DIR = Path.resolve(__dirname, "../../..");
export const APP_DISPLAY_NAME = desktopIdentity.displayName;
export const APP_USER_MODEL_ID = desktopIdentity.bundleId;
export const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
export const COMMIT_HASH_DISPLAY_LENGTH = 12;
export const LOG_DIR = Path.join(STATE_DIR, "logs");
export const DESKTOP_LOG_FILE_NAME = "desktop-main.log";
export const BACKEND_LOG_FILE_NAME = "server-child.log";
export const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const LOG_FILE_MAX_FILES = 10;
export const APP_RUN_ID = Crypto.randomBytes(6).toString("hex");
export const DESKTOP_BACKEND_SHUTDOWN_TOKEN = Crypto.randomBytes(32).toString("hex");
export const DESKTOP_BROWSER_HOST_CAPABILITY = Crypto.randomBytes(32).toString("base64url");
export const DESKTOP_BROWSER_HOST_CAPABILITY_FD = 3;
export const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
export const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const AUTO_UPDATE_FOREGROUND_RECHECK_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const AUTO_UPDATE_FOREGROUND_RECHECK_MIN_BACKGROUND_MS = 30 * 1000;
export const AUTO_UPDATE_CHECK_TIMEOUT_MS = 45 * 1000;
export const AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS = 60 * 1000;
export const AUTO_UPDATE_DOWNLOAD_SETTLE_TIMEOUT_MS = 20 * 1000;
export const AUTO_UPDATE_STALLED_DOWNLOAD_CANCELLATION_SUPPRESSION_MS = 2 * 60 * 1000;
export const AUTO_UPDATE_INSTALL_WATCHDOG_MS = 15 * 1000;
export const AUTO_UPDATE_DIAGNOSTICS_TIMEOUT_MS = 2_800;
export const BROWSER_SESSION_RESTORE_TIMEOUT_MS = 5_000;
export const UPDATE_INSTALL_MARKER_FILE_NAME = "pending-update-install.json";
export const BACKEND_FORCE_KILL_DELAY_MS = 8_000;
export const BACKEND_SHUTDOWN_TIMEOUT_MS = 10_000;
export const POSIX_BACKEND_TERMINATE_DELAY_MS = 15_000;
export const POSIX_BACKEND_FORCE_KILL_DELAY_MS = 18_000;
export const POSIX_BACKEND_SHUTDOWN_TIMEOUT_MS = 20_000;
export const BACKEND_MAX_OLD_SPACE_ENV_KEYS = ["GLADE_BACKEND_MAX_OLD_SPACE_MB"] as const;
export const DESKTOP_UPDATE_ALLOW_PRERELEASE = false;
export const BROWSER_PERF_SAMPLE_INTERVAL_MS = 5_000;
export const DESKTOP_MENU_ZOOM_FACTOR_STEP = 1.1;
export const DESKTOP_MENU_MIN_ZOOM_FACTOR = 0.25;
export const DESKTOP_MENU_MAX_ZOOM_FACTOR = 5;
export const GLADE_BROWSER_LABEL = "Glade browser";
export const CONTEXT_MENU_ICON_DATA_URL_PREFIX = "data:image/png;base64,";
export const CONTEXT_MENU_ICON_MAX_DATA_URL_LENGTH = 64_000;
export const MAC_CONTEXT_MENU_LABEL_TRAILING_PADDING = "\u2003\u2003";
export const BUNDLE_SWAP_POLL_INTERVAL_MS = 15_000;
export const MIN_DESKTOP_WINDOW_WIDTH = 1024;
export const MIN_DESKTOP_WINDOW_HEIGHT = 700;
export const userDataPath = resolveDesktopUserDataPath({
  appDataBase: resolveDesktopAppDataBase(),
  userDataDirectoryName: desktopIdentity.userDataDirectoryName,
  testOverridePath: canOverrideDesktopSmokeUserData({
    packagedFlavor: packagedDesktopFlavor,
    sourceBuildMarker: requestedSourceBuildMarker,
  })
    ? process.env[GLADE_DESKTOP_SMOKE_USER_DATA_ENV]
    : undefined,
});
