import { ElectronBlocker } from "@ghostery/adblocker-electron";
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
// The serialized engine is cached on disk and rebuilt from the lists in the background once a
// day. Startup never waits for the network: until an engine is loaded, nothing is blocked.
export class ContentBlocker {
  private engine: ElectronBlocker | null = null;
  private preloadId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private on: boolean;

  constructor(
    private readonly session: Session,
    private readonly files: { readonly cache: string; readonly setting: string },
    private readonly log: (message: string) => void,
  ) {
    this.on = readSetting(files.setting);
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
    FS.mkdirSync(Path.dirname(this.files.setting), { recursive: true });
    FS.writeFileSync(this.files.setting, JSON.stringify({ version: 1, enabled }), "utf8");
    this.on = enabled;
    this.applyCosmetics();
    return enabled;
  }

  onBeforeRequest(details: OnBeforeRequestListenerDetails, callback: BeforeRequestCallback): void {
    const engine = this.active();
    if (engine) engine.onBeforeRequest(details, callback);
    else callback({});
  }

  onHeadersReceived(
    details: OnHeadersReceivedListenerDetails,
    callback: HeadersReceivedCallback,
  ): void {
    const engine = this.active();
    if (engine) engine.onHeadersReceived(details, callback);
    else callback({});
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
          ? this.active()?.onInjectCosmeticFilters(event, url, update)
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

// On unless the user turned it off.
function readSetting(path: string): boolean {
  try {
    const stored: unknown = JSON.parse(FS.readFileSync(path, "utf8"));
    return !(
      typeof stored === "object" &&
      stored !== null &&
      Reflect.get(stored, "enabled") === false
    );
  } catch {
    return true;
  }
}
