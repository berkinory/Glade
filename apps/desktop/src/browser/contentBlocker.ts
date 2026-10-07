import { ElectronBlocker, Request } from "@ghostery/adblocker-electron";
import {
  ipcMain,
  type IpcMainInvokeEvent,
  type OnBeforeRequestListenerDetails,
  type OnHeadersReceivedListenerDetails,
  type Session,
} from "electron";
import * as FS from "node:fs";
import * as Path from "node:path";

type BeforeRequestCallback = (response: Electron.CallbackResponse) => void;
type HeadersReceivedCallback = (response: Electron.HeadersReceivedResponse) => void;
type CosmeticsUpdate = Parameters<ElectronBlocker["onInjectCosmeticFilters"]>[2];

// Channels the Ghostery preload invokes; they are fixed by that package.
const INJECT_COSMETICS = "@ghostery/adblocker/inject-cosmetic-filters";
const MUTATION_OBSERVER = "@ghostery/adblocker/is-mutation-observer-enabled";
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 60 * 60 * 1000;

// Ghostery's engine with its prebuilt ads, tracking and annoyance lists (EasyList, EasyPrivacy,
// uBlock Origin's filters, privacy and cookie-notice lists) on the browser partition.
//
// Electron keeps one webRequest listener per event and session, so this class does not register
// any: the partition's single listeners call it after Glade's URL policy. Element hiding needs
// Ghostery's preload in every frame, registered on the partition only while blocking is on; it
// runs in the preload's isolated world and talks to the main process over two IPC channels.
//
// Sites the user or agent turned blocking off for are kept by registrable domain (eTLD+1, parsed
// by the engine's own Request) next to the on/off setting. Every request and cosmetic injection
// of a page on such a site is let through, including its third-party ones.
//
// The serialized engine is cached on disk and rebuilt from the lists in the background once a
// day. Startup never waits for the network: until an engine is loaded, nothing is blocked.
export class ContentBlocker {
  private engine: ElectronBlocker | null = null;
  private preloadId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private on: boolean;
  private readonly allowedSites: Set<string>;

  constructor(
    private readonly session: Session,
    private readonly files: { readonly cache: string; readonly setting: string },
    private readonly log: (message: string) => void,
  ) {
    const setting = readSetting(files.setting);
    this.on = setting.enabled;
    this.allowedSites = new Set(setting.allowedSites);
  }

  start(): void {
    this.applyCosmetics();
    this.loadCached();
    void this.refreshWhenStale();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.engine = null;
    this.applyCosmetics();
  }

  enabled(): boolean {
    return this.on;
  }

  setEnabled(enabled: boolean): boolean {
    this.on = enabled;
    this.save();
    this.applyCosmetics();
    return enabled;
  }

  // Whether blocking applies to the page at `url` while the blocker is on; null when the page has
  // no site to key an exception by.
  siteBlocking(url: string): boolean | null {
    const site = siteOf(url);
    return site === null ? null : !this.allowedSites.has(site);
  }

  // Returns the site the setting now applies to. Pages pick it up on their next load.
  setSiteBlocking(url: string, blocking: boolean): string | null {
    const site = siteOf(url);
    if (site === null) return null;
    if (blocking) this.allowedSites.delete(site);
    else this.allowedSites.add(site);
    this.save();
    return site;
  }

  onBeforeRequest(details: OnBeforeRequestListenerDetails, callback: BeforeRequestCallback): void {
    const engine = this.activeFor(pageUrl(details));
    if (engine) engine.onBeforeRequest(details, callback);
    else callback({});
  }

  onHeadersReceived(
    details: OnHeadersReceivedListenerDetails,
    callback: HeadersReceivedCallback,
  ): void {
    const engine = this.activeFor(pageUrl(details));
    if (engine) engine.onHeadersReceived(details, callback);
    else callback({});
  }

  private activeFor(page: string | null): ElectronBlocker | null {
    const engine = this.active();
    if (!engine || this.allowedSites.size === 0 || page === null) return engine;
    const site = siteOf(page);
    return site !== null && this.allowedSites.has(site) ? null : engine;
  }

  private save(): void {
    FS.mkdirSync(Path.dirname(this.files.setting), { recursive: true });
    FS.writeFileSync(
      this.files.setting,
      JSON.stringify({
        version: 1,
        enabled: this.on,
        allowedSites: [...this.allowedSites].toSorted(),
      }),
      "utf8",
    );
  }

  private active(): ElectronBlocker | null {
    return this.on ? this.engine : null;
  }

  private loadCached(): void {
    try {
      this.use(ElectronBlocker.deserialize(new Uint8Array(FS.readFileSync(this.files.cache))));
    } catch {
      // Missing, or written by another library version; the refresh rebuilds it.
    }
  }

  private async refreshWhenStale(): Promise<void> {
    const age = (() => {
      try {
        return Date.now() - FS.statSync(this.files.cache).mtimeMs;
      } catch {
        return Number.POSITIVE_INFINITY;
      }
    })();
    if (this.engine && age < REFRESH_AFTER_MS) return this.schedule(REFRESH_AFTER_MS - age);
    try {
      const engine = await ElectronBlocker.fromPrebuiltFull((url: string) =>
        this.session.fetch(url),
      );
      const temporary = `${this.files.cache}.${process.pid}.tmp`;
      FS.mkdirSync(Path.dirname(this.files.cache), { recursive: true });
      FS.writeFileSync(temporary, engine.serialize());
      FS.renameSync(temporary, this.files.cache);
      this.use(engine);
      this.schedule(REFRESH_AFTER_MS);
    } catch (error) {
      this.log(
        `content blocker lists unavailable message=${error instanceof Error ? error.message : String(error)}`,
      );
      this.schedule(RETRY_AFTER_MS);
    }
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refreshWhenStale(), delayMs);
    this.timer.unref();
  }

  private use(engine: ElectronBlocker): void {
    this.engine = engine;
    this.applyCosmetics();
  }

  // Registers or removes the element-hiding preload to match the setting; pages pick it up on
  // their next load.
  private applyCosmetics(): void {
    const wanted = this.active() !== null;
    if (wanted && this.preloadId === null) {
      this.preloadId = this.session.registerPreloadScript({
        type: "frame",
        filePath: require.resolve("@ghostery/adblocker-electron-preload"),
      });
      ipcMain.handle(INJECT_COSMETICS, (event, url: unknown, update: CosmeticsUpdate) =>
        this.fromPartition(event) && typeof url === "string"
          ? this.activeFor(event.sender.getURL())?.onInjectCosmeticFilters(event, url, update)
          : undefined,
      );
      ipcMain.handle(MUTATION_OBSERVER, (event) =>
        this.fromPartition(event) ? this.active()?.onIsMutationObserverEnabled(event) : false,
      );
    } else if (!wanted && this.preloadId !== null) {
      this.session.unregisterPreloadScript(this.preloadId);
      this.preloadId = null;
      ipcMain.removeHandler(INJECT_COSMETICS);
      ipcMain.removeHandler(MUTATION_OBSERVER);
    }
  }

  // The channels are app-wide; only browser pages may use them.
  private fromPartition(event: IpcMainInvokeEvent): boolean {
    return event.sender.session === this.session;
  }
}

function siteOf(url: string): string | null {
  if (!/^https?:/iu.test(url)) return null;
  return Request.fromRawDetails({ url }).domain || null;
}

// The top-level page a request belongs to: the request itself for a navigation, else the page its
// tab shows.
function pageUrl(details: OnBeforeRequestListenerDetails | OnHeadersReceivedListenerDetails) {
  if (details.resourceType === "mainFrame") return details.url;
  const webContents = details.webContents;
  return webContents && !webContents.isDestroyed() ? webContents.getURL() : null;
}

// On unless the user turned it off; no site exceptions unless some were stored.
function readSetting(path: string): { enabled: boolean; allowedSites: string[] } {
  try {
    const stored: unknown = JSON.parse(FS.readFileSync(path, "utf8"));
    if (typeof stored !== "object" || stored === null) return { enabled: true, allowedSites: [] };
    const sites: unknown = Reflect.get(stored, "allowedSites");
    return {
      enabled: Reflect.get(stored, "enabled") !== false,
      allowedSites: Array.isArray(sites)
        ? sites.filter((site): site is string => typeof site === "string")
        : [],
    };
  } catch {
    return { enabled: true, allowedSites: [] };
  }
}
