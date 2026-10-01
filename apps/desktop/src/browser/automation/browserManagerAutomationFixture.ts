import { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { WebContents } from "electron";
import { EventEmitter } from "node:events";
import { vi, type Mock } from "vitest";
type DownloadListener = (event: object, item: object, webContents: object) => void;

const {
  browserSession,
  fromId,
  webContentsViewConstructor,
  willDownloadListener,
}: {
  browserSession: {
    setUserAgent: Mock;
    webRequest: { onBeforeSendHeaders: Mock; onHeadersReceived: Mock };
    protocol: { handle: Mock; unhandle: Mock };
    on: Mock<(event: string, listener: DownloadListener | null) => void>;
    removeListener: Mock;
  };
  fromId: Mock;
  webContentsViewConstructor: Mock;
  willDownloadListener: { current: DownloadListener | null };
} = vi.hoisted(() => {
  const willDownloadListener = {
    current: null as null | ((event: object, item: object, webContents: object) => void),
  };
  return {
    browserSession: {
      setUserAgent: vi.fn(),
      webRequest: { onBeforeSendHeaders: vi.fn(), onHeadersReceived: vi.fn() },
      protocol: { handle: vi.fn(), unhandle: vi.fn() },
      on: vi.fn((event: string, listener: typeof willDownloadListener.current) => {
        if (event === "will-download") willDownloadListener.current = listener;
      }),
      removeListener: vi.fn(),
    },
    fromId: vi.fn(),
    webContentsViewConstructor: vi.fn(),
    willDownloadListener,
  };
});

vi.mock("electron", () => ({
  app: {
    getName: () => "Glade",
    getPreferredSystemLanguages: () => ["en-US"],
    userAgentFallback: "Mozilla/5.0 Electron/40.0.0",
  },
  BrowserWindow: class {},
  clipboard: { writeImage: vi.fn(), writeText: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  session: {
    fromPartition: () => browserSession,
  },
  webContents: { fromId },
  WebContentsView: class {
    constructor(options: Electron.WebContentsViewConstructorOptions) {
      return webContentsViewConstructor(options);
    }
  },
}));

export const THREAD_ID = ThreadId.makeUnsafe("thread-visible-runtime");

export class FakeWebContents extends EventEmitter {
  constructor(readonly id = 17) {
    super();
  }
  readonly debugger: { isAttached: () => boolean; detach: Mock } = {
    isAttached: () => false,
    detach: vi.fn(),
  };
  isDestroyed = () => false;
  setUserAgent: Mock = vi.fn();
  windowOpenHandler:
    | ((details: { url: string; frameName: string; features: string; disposition: string }) => {
        action: "allow" | "deny";
        createWindow?: (options: Electron.BrowserWindowConstructorOptions) => WebContents;
      })
    | undefined;
  setWindowOpenHandler = vi.fn((handler: NonNullable<FakeWebContents["windowOpenHandler"]>) => {
    this.windowOpenHandler = handler;
  });
  getURL = () => "https://example.test/";
  getTitle = () => "Example";
  isLoading = () => false;
  canGoBack = () => false;
  canGoForward = () => false;
  close: Mock = vi.fn();
  loadURL = vi.fn(() => Promise.resolve());
  setZoomFactor: Mock = vi.fn();
  getZoomFactor = () => 1;
}

export { browserSession, fromId, webContentsViewConstructor, willDownloadListener };
