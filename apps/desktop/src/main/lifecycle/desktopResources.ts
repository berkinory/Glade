import { app, dialog, protocol } from "electron";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { ensureStaticSnapshot, findAsarArchivePath } from "../../storage/staticSnapshot";
import {
  BUNDLE_SWAP_POLL_INTERVAL_MS,
  COMMIT_HASH_DISPLAY_LENGTH,
  COMMIT_HASH_PATTERN,
  DESKTOP_SCHEME,
  isDevelopment,
  ROOT_DIR,
  startupBundleIdentity,
} from "../desktopEnvironment";
import {
  isBundleStable,
  isBundleSwapped,
  isWatchableBundlePath,
  readBundleSignature,
  type BundleSignature,
} from "../protocol/bundleSwapDetection";
import { createDesktopStaticProtocolResolver } from "../protocol/desktopStaticProtocol";
import type { DesktopLog } from "./desktopLogging";
import { formatErrorMessage } from "./desktopLogging";
export interface ServedStaticRoot {
  readonly dir: string;
  readonly snapshotted: boolean;
}

export class BundleChangedDuringStartupError extends Error {
  readonly bundlePath: string;
  readonly baseline: BundleSignature | null;
  readonly current: BundleSignature | null;
  constructor(input: {
    bundlePath: string;
    baseline: BundleSignature | null;
    current: BundleSignature | null;
  }) {
    super("The packaged application changed while its static assets were being prepared.");
    this.name = "BundleChangedDuringStartupError";
    this.bundlePath = input.bundlePath;
    this.baseline = input.baseline;
    this.current = input.current;
  }
}
export interface ResourceLifecycle {
  isQuitting(): boolean;
  markQuitting(): void;
  isInstallPreparing(): boolean;
  requestGracefulAppQuit(reason: string): void;
}
declare const __GLADE_WINDOWS_UPDATER_PUBLISHER__: string;
export function createDesktopResources(log: DesktopLog, lifecycle: ResourceLifecycle) {
  let appUpdateYmlCache: Record<string, string> | null | undefined;
  let aboutCommitHashCache: string | null | undefined;
  let servedStaticRootCache: ServedStaticRoot | null | undefined;
  let desktopProtocolRegistered = false;
  let bundleSwapPollTimer: NodeJS.Timeout | null = null;
  let bundleSwapPromptOpen = false;

  function resolveAppRoot(): string {
    if (!app.isPackaged) {
      return ROOT_DIR;
    }
    return app.getAppPath();
  }

  function readAppUpdateYml(): Record<string, string> | null {
    if (appUpdateYmlCache !== undefined) {
      return appUpdateYmlCache;
    }
    appUpdateYmlCache = parseAppUpdateYml();
    return appUpdateYmlCache;
  }

  function parseAppUpdateYml(): Record<string, string> | null {
    try {
      const ymlPath = app.isPackaged
        ? Path.join(process.resourcesPath, "app-update.yml")
        : Path.join(app.getAppPath(), "dev-app-update.yml");
      const raw = FS.readFileSync(ymlPath, "utf-8");

      const entries: Record<string, string> = {};
      for (const line of raw.split("\n")) {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match?.[1] && match[2]) entries[match[1]] = match[2].trim();
      }
      return entries.provider ? entries : null;
    } catch {
      return null;
    }
  }

  function normalizeCommitHash(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    if (!COMMIT_HASH_PATTERN.test(trimmed)) {
      return null;
    }
    return trimmed.slice(0, COMMIT_HASH_DISPLAY_LENGTH).toLowerCase();
  }

  function resolveEmbeddedCommitHash(): string | null {
    const packageJsonPath = Path.join(resolveAppRoot(), "package.json");
    if (!FS.existsSync(packageJsonPath)) {
      return null;
    }

    try {
      const raw = FS.readFileSync(packageJsonPath, "utf8");
      const parsed = JSON.parse(raw) as { gladeCommitHash?: unknown };
      return normalizeCommitHash(parsed.gladeCommitHash);
    } catch {
      return null;
    }
  }

  function resolveEmbeddedWindowsPublisherSubjects(): string[] {
    if (!app.isPackaged || process.platform !== "win32") {
      return [];
    }

    const subject = __GLADE_WINDOWS_UPDATER_PUBLISHER__.trim();
    return subject ? [subject] : [];
  }

  function resolveAboutCommitHash(): string | null {
    if (aboutCommitHashCache !== undefined) {
      return aboutCommitHashCache;
    }

    const envCommitHash = normalizeCommitHash(process.env.GLADE_COMMIT_HASH);
    if (envCommitHash) {
      aboutCommitHashCache = envCommitHash;
      return aboutCommitHashCache;
    }

    if (!app.isPackaged) {
      aboutCommitHashCache = null;
      return aboutCommitHashCache;
    }

    aboutCommitHashCache = resolveEmbeddedCommitHash();

    return aboutCommitHashCache;
  }

  function resolveBackendEntry(): string {
    return Path.join(resolveAppRoot(), "apps/server/dist/index.mjs");
  }

  function resolveBackendCwd(): string {
    if (!app.isPackaged) {
      return resolveAppRoot();
    }
    return OS.homedir();
  }

  function resolveDesktopStaticDir(): string | null {
    const appRoot = resolveAppRoot();
    const candidates = [
      Path.join(appRoot, "apps/server/dist/client"),
      Path.join(appRoot, "apps/web/dist"),
    ];

    for (const candidate of candidates) {
      if (FS.existsSync(Path.join(candidate, "index.html"))) {
        return candidate;
      }
    }

    return null;
  }

  function resolveServedStaticRoot(): ServedStaticRoot | null {
    if (servedStaticRootCache === undefined) {
      servedStaticRootCache = computeServedStaticRoot();
    }
    return servedStaticRootCache;
  }

  function computeServedStaticRoot(): ServedStaticRoot | null {
    const sourceDir = resolveDesktopStaticDir();
    if (!sourceDir) {
      return null;
    }
    const archivePath = findAsarArchivePath(sourceDir);
    if (!archivePath) {
      return { dir: sourceDir, snapshotted: false };
    }
    const startupArchiveSignature =
      startupBundleIdentity &&
      Path.resolve(startupBundleIdentity.path) === Path.resolve(archivePath)
        ? startupBundleIdentity.signature
        : undefined;
    if (startupArchiveSignature === null) {
      throw new BundleChangedDuringStartupError({
        bundlePath: archivePath,
        baseline: null,
        current: readBundleSignature(archivePath),
      });
    }
    const archiveSignature = startupArchiveSignature ?? readBundleSignature(archivePath);
    if (!archiveSignature) {
      return { dir: sourceDir, snapshotted: false };
    }
    const startedAtMs = Date.now();
    let snapshot: ReturnType<typeof ensureStaticSnapshot>;
    try {
      snapshot = ensureStaticSnapshot({
        sourceDir,
        cacheRoot: Path.join(app.getPath("userData"), "static-snapshots"),
        signature: `${archiveSignature.size}-${archiveSignature.mtimeMs}-${archiveSignature.inode}`,
      });
    } catch (error) {
      const currentArchiveSignature = readBundleSignature(archivePath);
      if (!isBundleStable(archiveSignature, currentArchiveSignature)) {
        throw new BundleChangedDuringStartupError({
          bundlePath: archivePath,
          baseline: archiveSignature,
          current: currentArchiveSignature,
        });
      }
      console.warn(
        "[desktop] Failed to snapshot static assets; serving from the archive",
        formatErrorMessage(error),
      );
      return { dir: sourceDir, snapshotted: false };
    }

    const currentArchiveSignature = readBundleSignature(archivePath);
    if (!isBundleStable(archiveSignature, currentArchiveSignature)) {
      if (!snapshot.reused) {
        try {
          FS.rmSync(snapshot.dir, { recursive: true, force: true });
        } catch {}
      }
      throw new BundleChangedDuringStartupError({
        bundlePath: archivePath,
        baseline: archiveSignature,
        current: currentArchiveSignature,
      });
    }

    log.writeDesktopLogHeader(
      `static snapshot ${snapshot.reused ? "reused" : "created"} dir=${snapshot.dir} in ${Date.now() - startedAtMs}ms`,
    );
    return { dir: snapshot.dir, snapshotted: true };
  }

  function handleFatalStartupError(stage: string, error: unknown): void {
    const message = formatErrorMessage(error);
    const detail =
      error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
    log.writeDesktopLogHeader(`fatal startup error stage=${stage} message=${message}`);
    console.error(`[desktop] fatal startup error (${stage})`, error);
    if (!lifecycle.isQuitting()) {
      lifecycle.markQuitting();
      dialog.showErrorBox("Glade failed to start", `Stage: ${stage}\n${message}${detail}`);
    }
    lifecycle.requestGracefulAppQuit(`fatal startup (${stage})`);
  }

  function registerDesktopProtocol(): void {
    if (isDevelopment || desktopProtocolRegistered) return;

    if (startupBundleIdentity && !startupBundleIdentity.signature) {
      throw new BundleChangedDuringStartupError({
        bundlePath: startupBundleIdentity.path,
        baseline: null,
        current: readBundleSignature(startupBundleIdentity.path),
      });
    }

    const staticRoot = resolveServedStaticRoot()?.dir ?? null;
    if (!staticRoot) {
      throw new Error(
        "Desktop static bundle missing. Build apps/server (with bundled client) first.",
      );
    }

    const resolveStaticRequest = createDesktopStaticProtocolResolver(staticRoot);

    protocol.registerFileProtocol(DESKTOP_SCHEME, (request, callback) => {
      callback(resolveStaticRequest(request.url));
    });

    desktopProtocolRegistered = true;
  }

  function resolveResourcePath(fileName: string): string | null {
    const candidates = [
      Path.join(__dirname, "../resources", fileName),
      Path.join(__dirname, "../prod-resources", fileName),
      Path.join(process.resourcesPath, "resources", fileName),
      Path.join(process.resourcesPath, fileName),
    ];

    for (const candidate of candidates) {
      if (FS.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function resolveIconPath(ext: "ico" | "icns" | "png"): string | null {
    return resolveResourcePath(`icon.${ext}`);
  }

  function resolveNotificationIconPath(): string | null {
    if (process.platform === "darwin") {
      return null;
    }
    if (process.platform === "win32") {
      return resolveResourcePath("glade.png") ?? resolveIconPath("ico");
    }
    return resolveResourcePath("glade.png") ?? resolveIconPath("png");
  }

  function resolveComputerHelperPath(): string {
    if (app.isPackaged) {
      return Path.resolve(process.resourcesPath, "..", "Helpers", "glade-computer-helper");
    }
    return Path.resolve(__dirname, "..", ".electron-runtime", "computer", "glade-computer-helper");
  }

  function resolveComputerAppBundlePath(): string {
    let directory = Path.dirname(app.getPath("exe"));
    while (directory !== Path.dirname(directory)) {
      if (directory.endsWith(".app")) return directory;
      directory = Path.dirname(directory);
    }
    return app.getPath("exe");
  }

  function restartAfterStartupBundleSwap(error: BundleChangedDuringStartupError): void {
    const baselineSize = error.baseline?.size ?? "unreadable";
    const currentSize = error.current?.size ?? "unreadable";
    log.writeDesktopLogHeader(
      `bundle changed during startup path=${error.bundlePath} size=${baselineSize}->${currentSize}`,
    );
    console.warn("[desktop] Packaged application changed during startup; restarting", error);

    void dialog
      .showMessageBox({
        type: "warning",
        title: "Glade needs to restart",
        message: "Glade changed while it was opening.",
        detail:
          "The current process cannot safely read the replaced application bundle. Restart Glade to finish opening with one consistent version.",
        buttons: ["Restart Glade"],
        defaultId: 0,
      })
      .catch(() => undefined)
      .then(() => {
        app.relaunch();
        lifecycle.requestGracefulAppQuit("startup-bundle-swap");
      });
  }

  function startBundleSwapWatcher(): void {
    if (!app.isPackaged || bundleSwapPollTimer) {
      return;
    }
    const bundlePath = app.getAppPath();
    if (!isWatchableBundlePath(bundlePath)) {
      return;
    }
    let baseline =
      startupBundleIdentity && Path.resolve(startupBundleIdentity.path) === Path.resolve(bundlePath)
        ? (startupBundleIdentity.signature ?? readBundleSignature(bundlePath))
        : readBundleSignature(bundlePath);
    if (!baseline) {
      return;
    }

    bundleSwapPollTimer = setInterval(() => {
      if (lifecycle.isQuitting() || lifecycle.isInstallPreparing() || bundleSwapPromptOpen) {
        return;
      }
      const current = readBundleSignature(bundlePath);
      if (!baseline || !isBundleSwapped(baseline, current)) {
        return;
      }
      log.writeDesktopLogHeader(
        `bundle swap detected path=${bundlePath} size=${baseline.size}->${current?.size ?? "unknown"}`,
      );

      baseline = current;
      bundleSwapPromptOpen = true;
      void dialog
        .showMessageBox({
          type: "warning",
          title: "Glade was replaced on disk",
          message: "The installed Glade app changed while it was running.",
          detail:
            "The interface keeps running from a safeguarded copy, but parts of the app loaded later can still read the replaced file. Restart now to pick up the new version safely.",
          buttons: ["Restart Now", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          bundleSwapPromptOpen = false;
          if (response === 0) {
            app.relaunch();
            lifecycle.requestGracefulAppQuit("bundle-swap-restart");
          }
        })
        .catch(() => {
          bundleSwapPromptOpen = false;
        });
    }, BUNDLE_SWAP_POLL_INTERVAL_MS);
    bundleSwapPollTimer.unref();
  }
  return {
    resolveAppRoot,
    readAppUpdateYml,
    resolveEmbeddedWindowsPublisherSubjects,
    resolveAboutCommitHash,
    resolveBackendEntry,
    resolveBackendCwd,
    resolveServedStaticRoot,
    handleFatalStartupError,
    registerDesktopProtocol,
    resolveResourcePath,
    resolveNotificationIconPath,
    resolveComputerHelperPath,
    resolveComputerAppBundlePath,
    restartAfterStartupBundleSwap,
    startBundleSwapWatcher,
    dispose: () => {
      if (bundleSwapPollTimer) clearInterval(bundleSwapPollTimer);
      bundleSwapPollTimer = null;
    },
  };
}
