import { app, dialog, protocol } from "electron";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { ensureStaticSnapshot, findAsarArchivePath } from "../../storage/staticSnapshot";
import {
  BundleChangedDuringStartupError,
  ServedStaticRoot,
  type DesktopRuntime,
} from "../desktopRuntimeTypes";
import { isBundleStable } from "../protocol/bundleSwapDetection";
import { createDesktopStaticProtocolResolver } from "../protocol/desktopStaticProtocol";

declare const __GLADE_WINDOWS_UPDATER_PUBLISHER__: string;

export function createDesktopResources(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "ROOT_DIR"
    | "appUpdateYmlCache"
    | "COMMIT_HASH_PATTERN"
    | "COMMIT_HASH_DISPLAY_LENGTH"
    | "aboutCommitHashCache"
    | "servedStaticRootCache"
    | "startupBundleIdentity"
    | "readBundleSignature"
    | "formatErrorMessage"
    | "writeDesktopLogHeader"
    | "isQuitting"
    | "requestGracefulAppQuit"
    | "isDevelopment"
    | "desktopProtocolRegistered"
    | "DESKTOP_SCHEME"
  >,
) {
  function resolveAppRoot(): string {
    if (!app.isPackaged) {
      return desktopRuntime.ROOT_DIR;
    }
    return app.getAppPath();
  }

  function readAppUpdateYml(): Record<string, string> | null {
    if (desktopRuntime.appUpdateYmlCache !== undefined) {
      return desktopRuntime.appUpdateYmlCache;
    }
    desktopRuntime.appUpdateYmlCache = parseAppUpdateYml();
    return desktopRuntime.appUpdateYmlCache;
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
    if (!desktopRuntime.COMMIT_HASH_PATTERN.test(trimmed)) {
      return null;
    }
    return trimmed.slice(0, desktopRuntime.COMMIT_HASH_DISPLAY_LENGTH).toLowerCase();
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
    if (desktopRuntime.aboutCommitHashCache !== undefined) {
      return desktopRuntime.aboutCommitHashCache;
    }

    const envCommitHash = normalizeCommitHash(process.env.GLADE_COMMIT_HASH);
    if (envCommitHash) {
      desktopRuntime.aboutCommitHashCache = envCommitHash;
      return desktopRuntime.aboutCommitHashCache;
    }

    if (!app.isPackaged) {
      desktopRuntime.aboutCommitHashCache = null;
      return desktopRuntime.aboutCommitHashCache;
    }

    desktopRuntime.aboutCommitHashCache = resolveEmbeddedCommitHash();

    return desktopRuntime.aboutCommitHashCache;
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
    if (desktopRuntime.servedStaticRootCache === undefined) {
      desktopRuntime.servedStaticRootCache = computeServedStaticRoot();
    }
    return desktopRuntime.servedStaticRootCache;
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
      desktopRuntime.startupBundleIdentity &&
      Path.resolve(desktopRuntime.startupBundleIdentity.path) === Path.resolve(archivePath)
        ? desktopRuntime.startupBundleIdentity.signature
        : undefined;
    if (startupArchiveSignature === null) {
      throw new BundleChangedDuringStartupError({
        bundlePath: archivePath,
        baseline: null,
        current: desktopRuntime.readBundleSignature(archivePath),
      });
    }
    const archiveSignature =
      startupArchiveSignature ?? desktopRuntime.readBundleSignature(archivePath);
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
      const currentArchiveSignature = desktopRuntime.readBundleSignature(archivePath);
      if (!isBundleStable(archiveSignature, currentArchiveSignature)) {
        throw new BundleChangedDuringStartupError({
          bundlePath: archivePath,
          baseline: archiveSignature,
          current: currentArchiveSignature,
        });
      }
      console.warn(
        "[desktop] Failed to snapshot static assets; serving from the archive",
        desktopRuntime.formatErrorMessage(error),
      );
      return { dir: sourceDir, snapshotted: false };
    }

    const currentArchiveSignature = desktopRuntime.readBundleSignature(archivePath);
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

    desktopRuntime.writeDesktopLogHeader(
      `static snapshot ${snapshot.reused ? "reused" : "created"} dir=${snapshot.dir} in ${Date.now() - startedAtMs}ms`,
    );
    return { dir: snapshot.dir, snapshotted: true };
  }

  function handleFatalStartupError(stage: string, error: unknown): void {
    const message = desktopRuntime.formatErrorMessage(error);
    const detail =
      error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
    desktopRuntime.writeDesktopLogHeader(`fatal startup error stage=${stage} message=${message}`);
    console.error(`[desktop] fatal startup error (${stage})`, error);
    if (!desktopRuntime.isQuitting) {
      desktopRuntime.isQuitting = true;
      dialog.showErrorBox("Glade failed to start", `Stage: ${stage}\n${message}${detail}`);
    }
    desktopRuntime.requestGracefulAppQuit(`fatal startup (${stage})`);
  }

  function registerDesktopProtocol(): void {
    if (desktopRuntime.isDevelopment || desktopRuntime.desktopProtocolRegistered) return;

    if (desktopRuntime.startupBundleIdentity && !desktopRuntime.startupBundleIdentity.signature) {
      throw new BundleChangedDuringStartupError({
        bundlePath: desktopRuntime.startupBundleIdentity.path,
        baseline: null,
        current: desktopRuntime.readBundleSignature(desktopRuntime.startupBundleIdentity.path),
      });
    }

    const staticRoot = resolveServedStaticRoot()?.dir ?? null;
    if (!staticRoot) {
      throw new Error(
        "Desktop static bundle missing. Build apps/server (with bundled client) first.",
      );
    }

    const resolveStaticRequest = createDesktopStaticProtocolResolver(staticRoot);

    protocol.registerFileProtocol(desktopRuntime.DESKTOP_SCHEME, (request, callback) => {
      callback(resolveStaticRequest(request.url));
    });

    desktopRuntime.desktopProtocolRegistered = true;
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
  };
}
