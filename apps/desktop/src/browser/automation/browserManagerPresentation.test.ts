// Register the Electron fixture before the browser runtime imports.
import {
  browserSession,
  FakeWebContents,
  fromId,
  THREAD_ID,
  webContentsViewConstructor,
  willDownloadListener,
} from "./browserManagerAutomationFixture";

import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { DesktopBrowserManager } from "../browserManager";

describe("DesktopBrowserManager automation runtime boundary", () => {
  it("parks native previews outside hit testing, captures bounded frames and restores the same page", async () => {
    const contents = new FakeWebContents(121);
    const thumbnail = { toJPEG: vi.fn(() => Buffer.from("thumbnail")) };
    const image = {
      isEmpty: () => false,
      getSize: () => ({ width: 1280, height: 800 }),
      resize: vi.fn(() => thumbnail),
    };
    const capturePage = vi.fn(async () => image);
    Object.assign(contents, { capturePage });
    const view = {
      webContents: contents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      setBorderRadius: vi.fn(),
    };
    webContentsViewConstructor.mockReturnValueOnce(view);
    const manager = new DesktopBrowserManager();
    const parent = { addChildView: vi.fn(), removeChildView: vi.fn() };
    manager.setWindow({ contentView: parent } as never);
    try {
      const state = manager.open({ threadId: THREAD_ID, initialUrl: "https://example.test/" });
      const input = { threadId: THREAD_ID, tabId: state.activeTabId! };
      const bounds = { x: 300, y: 200, width: 320, height: 200 };
      manager.setPanelBounds({ threadId: THREAD_ID, surface: "native", bounds, preview: true });
      const loads = contents.loadURL.mock.calls.length;
      expect(view.setBounds).toHaveBeenLastCalledWith({ ...bounds, x: 0, y: 0 });
      expect(parent.addChildView).toHaveBeenLastCalledWith(view, 0);
      expect(parent.removeChildView.mock.invocationCallOrder.at(-1)).toBeLessThan(
        parent.addChildView.mock.invocationCallOrder.at(-1)!,
      );
      expect(await manager.capturePreview(input)).toBe(
        `data:image/jpeg;base64,${Buffer.from("thumbnail").toString("base64")}`,
      );
      expect(image.resize).toHaveBeenCalledWith({ width: 640 });
      expect(capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true, stayAwake: true });
      manager.setPanelBounds({ threadId: THREAD_ID, surface: "native", bounds });
      expect(view.setBounds).toHaveBeenLastCalledWith(bounds);
      expect(parent.addChildView).toHaveBeenLastCalledWith(view);
      expect(manager.getVisibleAutomationRuntime(input).webContents).toBe(contents);
      expect(contents.loadURL).toHaveBeenCalledTimes(loads);
      expect(await manager.capturePreview(input)).toBeNull();
      expect(contents.close).not.toHaveBeenCalled();
    } finally {
      manager.dispose();
    }
  });

  it("does not suspend a native page behind a long-lived menu, but still suspends after panel hide", async () => {
    vi.useFakeTimers();
    const contents = new FakeWebContents(101);
    const view = {
      webContents: contents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      setBorderRadius: vi.fn(),
    };
    webContentsViewConstructor.mockReturnValueOnce(view);
    const manager = new DesktopBrowserManager();
    const parent = { addChildView: vi.fn(), removeChildView: vi.fn() };
    manager.setWindow({ contentView: parent } as never);
    try {
      const state = manager.open({ threadId: THREAD_ID, initialUrl: "https://example.test/" });
      const input = { threadId: THREAD_ID, tabId: state.activeTabId! };
      const bounds = { x: 0, y: 50, width: 600, height: 600 };
      manager.setPanelBounds({ threadId: THREAD_ID, surface: "native", bounds });
      const runtime = manager.getVisibleAutomationRuntime(input);
      const loads = contents.loadURL.mock.calls.length;
      manager.setPanelBounds({
        threadId: THREAD_ID,
        surface: "native",
        bounds: null,
        occluded: true,
      });
      expect(parent.removeChildView).toHaveBeenCalledWith(view);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(contents.close).not.toHaveBeenCalled();
      manager.setPanelBounds({ threadId: THREAD_ID, surface: "native", bounds });
      expect(manager.getVisibleAutomationRuntime(input).webContents).toBe(runtime.webContents);
      expect(contents.loadURL).toHaveBeenCalledTimes(loads);
      manager.setPanelBounds({
        threadId: THREAD_ID,
        surface: "native",
        bounds: null,
        occluded: true,
      });
      manager.hide({ threadId: THREAD_ID });
      await vi.advanceTimersByTimeAsync(30_001);
      expect(contents.close).toHaveBeenCalledOnce();
    } finally {
      manager.dispose();
      vi.useRealTimers();
    }
  });

  it.each([
    { nested: false, delayed: false },
    { nested: false, delayed: true },
    { nested: true, delayed: true },
  ])("contains embedded popup downloads until human takeover: %j", async ({ nested, delayed }) => {
    const source = new FakeWebContents(201);
    const child = new FakeWebContents(202);
    const grandchild = new FakeWebContents(203);
    for (const webContents of [source, child, ...(nested ? [grandchild] : [])]) {
      webContentsViewConstructor.mockReturnValueOnce({
        webContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
      });
    }
    const manager = new DesktopBrowserManager();
    manager.setWindow({
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    } as never);
    try {
      const state = manager.open({ threadId: THREAD_ID });
      manager.setPanelBounds({
        threadId: THREAD_ID,
        surface: "native",
        bounds: { x: 0, y: 50, width: 600, height: 600 },
      });
      const release = manager.trackAutomationDownload(
        { threadId: THREAD_ID, tabId: state.activeTabId! },
        vi.fn(),
      );
      const openPopup = (opener: FakeWebContents, popup: FakeWebContents) => {
        const decision = opener.windowOpenHandler!({
          url: "https://example.test/popup",
          frameName: "auth",
          features: "width=480,height=640",
          disposition: "new-window",
        });
        expect(decision.action).toBe("allow");
        expect(decision.createWindow).toBeTypeOf("function");
        expect(decision.createWindow!({ webContents: popup } as never)).toBe(popup);
      };
      openPopup(source, child);
      if (delayed) release();
      if (nested) openPopup(child, grandchild);

      if (delayed) await new Promise<void>((resolve) => setImmediate(resolve));
      const target = nested ? grandchild : child;
      const download = { preventDefault: vi.fn() };
      willDownloadListener.current!(download, {}, target);
      expect(download.preventDefault).toHaveBeenCalledOnce();
      release();

      target.emit(
        "before-mouse-event",
        {},
        {
          type: "mouseDown",
          button: "left",
          x: 20,
          y: 20,
        },
      );
      const manualDownload = { preventDefault: vi.fn() };
      willDownloadListener.current!(manualDownload, {}, target);
      expect(manualDownload.preventDefault).not.toHaveBeenCalled();
      // A popup opened after genuine human input must not inherit a spent automation epoch either.
      if (!nested) {
        webContentsViewConstructor.mockReturnValueOnce({
          webContents: grandchild,
          setBounds: vi.fn(),
          setVisible: vi.fn(),
          setBorderRadius: vi.fn(),
        });
        openPopup(child, grandchild);
        const manualChildDownload = { preventDefault: vi.fn() };
        willDownloadListener.current!(manualChildDownload, {}, grandchild);
        expect(manualChildDownload.preventDefault).not.toHaveBeenCalled();
      }
    } finally {
      manager.dispose();
    }
  });

  it("loads an adopted agent tab once and keeps its deferred downloads contained", async () => {
    const source = new FakeWebContents(97);
    const contents = new FakeWebContents(98);
    let popupUrl = "";
    contents.getURL = () => popupUrl;
    contents.loadURL = vi.fn(async (url?: string) => {
      popupUrl = url ?? "";
    });
    const view = (webContents: FakeWebContents) => ({
      webContents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      setBorderRadius: vi.fn(),
    });
    webContentsViewConstructor
      .mockReturnValueOnce(view(source))
      .mockReturnValueOnce(view(contents));
    const manager = new DesktopBrowserManager();
    manager.setWindow({
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    } as never);
    const state = manager.open({ threadId: THREAD_ID });
    const bounds = { x: 0, y: 50, width: 600, height: 600 };
    manager.setPanelBounds({ threadId: THREAD_ID, surface: "native", bounds });
    const input = { threadId: THREAD_ID, tabId: state.activeTabId! };
    const stopDownloads = manager.trackAutomationDownload(input, vi.fn());
    const stopTracking = manager.trackAutomationWindowOpen(input, vi.fn());
    source.windowOpenHandler?.({
      url: "https://opened.example/path",
      frameName: "",
      features: "",
      disposition: "foreground-tab",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    stopTracking();
    stopDownloads();
    await vi.waitFor(() =>
      expect(contents.loadURL).toHaveBeenCalledWith("https://opened.example/path"),
    );
    const download = { preventDefault: vi.fn() };
    willDownloadListener.current?.(download, {}, contents);
    expect(download.preventDefault).toHaveBeenCalledOnce();
    const loads = contents.loadURL.mock.calls.length;
    manager.setPanelBounds({ threadId: THREAD_ID, surface: "native", bounds: null });
    manager.setPanelBounds({ threadId: THREAD_ID, surface: "native", bounds });
    expect(contents.loadURL).toHaveBeenCalledTimes(loads);
    manager.dispose();
  });

  it("allows an owner import while the selected native tab is covered, without revealing or claiming it", async () => {
    const contents = new FakeWebContents(99);
    const view = {
      webContents: contents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      setBorderRadius: vi.fn(),
    };
    webContentsViewConstructor.mockReturnValueOnce(view);
    const manager = new DesktopBrowserManager();
    manager.setWindow({
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    } as never);
    const state = manager.open({ threadId: THREAD_ID });
    const input = { threadId: THREAD_ID, tabId: state.activeTabId! };
    manager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "native",
      bounds: { x: 0, y: 50, width: 600, height: 600 },
    });
    manager.setPanelBounds({ threadId: THREAD_ID, surface: "native", bounds: null });
    expect(() => manager.getVisibleAutomationRuntime(input)).toThrow("not currently visible");
    view.setVisible.mockClear();
    expect((await manager.getCookieImportRuntime(input)).webContents).toBe(contents);
    expect(view.setVisible).not.toHaveBeenCalledWith(true);
    await expect(
      manager.getCookieImportRuntime({ ...input, threadId: ThreadId.makeUnsafe("another-thread") }),
    ).rejects.toThrow();
    await expect(
      manager.getCookieImportRuntime({ ...input, tabId: "another-tab" }),
    ).rejects.toThrow();
    manager.dispose();
  });

  it("keeps a manually opened native page alive across expanded and floating presentations", async () => {
    const contents = new FakeWebContents(100);
    webContentsViewConstructor.mockReturnValueOnce({
      webContents: contents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      setBorderRadius: vi.fn(),
    });
    const manager = new DesktopBrowserManager();
    manager.setWindow({
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    } as never);
    const state = manager.open({ threadId: THREAD_ID });
    expect(state.tabs[0]?.runtimeSurface).toBe("native");
    manager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "native",
      bounds: { x: 700, y: 50, width: 600, height: 700 },
      pageZoomFactor: 1,
    });
    const tabId = state.activeTabId!;
    const before = await manager.getAutomationRuntime({ threadId: THREAD_ID, tabId });
    const loads = contents.loadURL.mock.calls.length;
    manager.hide({ threadId: THREAD_ID });
    manager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "native",
      bounds: { x: 900, y: 500, width: 320, height: 200 },
      pageZoomFactor: 0.25,
    });
    const floating = await manager.getAutomationRuntime({ threadId: THREAD_ID, tabId });
    manager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "native",
      bounds: { x: 600, y: 50, width: 700, height: 700 },
      pageZoomFactor: 1,
    });
    expect(floating.webContents).toBe(before.webContents);
    expect(contents.loadURL).toHaveBeenCalledTimes(loads);
    expect(contents.close).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("applies explicit page zoom to native and renderer guests, then resets it on hide", () => {
    const nativeWebContents = new FakeWebContents(101);
    const nativeView = {
      webContents: nativeWebContents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      setBorderRadius: vi.fn(),
    };
    webContentsViewConstructor.mockReturnValueOnce(nativeView);

    const nativeManager = new DesktopBrowserManager();
    nativeManager.setWindow({
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    } as never);
    nativeManager.open({ threadId: THREAD_ID });
    nativeManager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "native",
      bounds: { x: 0, y: 0, width: 480, height: 340 },
      pageZoomFactor: 0.375,
    });
    expect(nativeWebContents.setZoomFactor).toHaveBeenLastCalledWith(0.375);

    nativeManager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "native",
      bounds: { x: 0, y: 0, width: 640, height: 340 },
      pageZoomFactor: 0.5,
    });
    expect(nativeWebContents.setZoomFactor).toHaveBeenLastCalledWith(0.5);

    nativeManager.hide({ threadId: THREAD_ID });
    expect(nativeWebContents.setZoomFactor).toHaveBeenLastCalledWith(1);
    nativeManager.dispose();

    const rendererWebContents = Object.assign(new FakeWebContents(102), {
      getType: () => "webview",
      hostWebContents: { id: 41 },
      session: browserSession,
      debugger: { isAttached: () => false, detach: vi.fn() },
    });
    fromId.mockReturnValue(rendererWebContents);
    const rendererManager = new DesktopBrowserManager();
    const state = rendererManager.open({ threadId: THREAD_ID });
    const tabId = state.activeTabId!;
    rendererManager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: 102 }, 41);
    rendererManager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "renderer",
      bounds: { x: 0, y: 0, width: 480, height: 340 },
      pageZoomFactor: 0.375,
    });
    expect(rendererWebContents.setZoomFactor).toHaveBeenLastCalledWith(0.375);

    rendererManager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "renderer",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });
    expect(rendererWebContents.setZoomFactor).toHaveBeenLastCalledWith(1);
    rendererManager.dispose();
  });

  it.each(["native", "renderer"] as const)(
    "restores the %s viewport on panel resize but preserves it during panel movement",
    (surface) => {
      const contents = Object.assign(new FakeWebContents(103), {
        getType: () => "webview",
        hostWebContents: { id: 41 },
        session: browserSession,
        debugger: {
          isAttached: () => true,
          detach: vi.fn(),
          sendCommand: vi.fn(async () => ({})),
        },
      });
      const manager = new DesktopBrowserManager();
      if (surface === "native") {
        webContentsViewConstructor.mockReturnValueOnce({
          webContents: contents,
          setBounds: vi.fn(),
          setVisible: vi.fn(),
          setBorderRadius: vi.fn(),
        });
        manager.setWindow({
          contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
        } as never);
      }
      const state = manager.open({ threadId: THREAD_ID });
      if (surface === "renderer") {
        fromId.mockReturnValue(contents);
        manager.attachWebview(
          { threadId: THREAD_ID, tabId: state.activeTabId!, webContentsId: 103 },
          41,
        );
      }
      const input = { threadId: THREAD_ID, surface };
      const bounds = { x: 0, y: 50, width: 800, height: 600 };
      try {
        manager.setPanelBounds({ ...input, bounds });
        contents.debugger.sendCommand.mockClear();
        manager.setPanelBounds({ ...input, bounds });
        manager.setPanelBounds({ ...input, bounds: { ...bounds, x: 10 } });
        expect(contents.debugger.sendCommand).not.toHaveBeenCalled();

        manager.setPanelBounds({ ...input, bounds: { ...bounds, width: 700 } });
        expect(contents.debugger.sendCommand).toHaveBeenCalledExactlyOnceWith(
          "Emulation.clearDeviceMetricsOverride",
        );
        manager.setPanelBounds({ ...input, bounds, pageZoomFactor: 0.5 });
        manager.setPanelBounds({ ...input, bounds, pageZoomFactor: 1 });
        expect(contents.debugger.sendCommand).toHaveBeenCalledTimes(3);
      } finally {
        manager.dispose();
      }
    },
  );

  it("demotes a native runtime to renderer when the floating surface claims the tab", () => {
    const nativeWebContents = new FakeWebContents(201);
    const nativeView = {
      webContents: nativeWebContents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      setBorderRadius: vi.fn(),
    };
    webContentsViewConstructor.mockReturnValueOnce(nativeView);

    const manager = new DesktopBrowserManager();
    const hostWindow = {
      webContents: Object.assign(new EventEmitter(), { id: 41, isDestroyed: () => false }),
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    };
    manager.setWindow(hostWindow as never);
    const opened = manager.open({ threadId: THREAD_ID });
    manager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "native",
      bounds: { x: 20, y: 40, width: 800, height: 600 },
    });
    expect(nativeWebContents.close).not.toHaveBeenCalled();

    manager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "renderer",
      bounds: { x: 40, y: 80, width: 320, height: 220 },
    });
    expect(nativeWebContents.close).not.toHaveBeenCalled();
    expect(nativeView.setVisible).toHaveBeenCalledWith(false);
    const next = manager.getState({ threadId: THREAD_ID });
    expect(next.tabs.find((tab) => tab.id === opened.activeTabId)?.runtimeSurface).toBe("renderer");

    const guest = Object.assign(new FakeWebContents(202), {
      getType: () => "webview",
      hostWebContents: hostWindow.webContents,
      session: browserSession,
    });
    fromId.mockReturnValue(guest);
    manager.attachWebview(
      { threadId: THREAD_ID, tabId: opened.activeTabId!, webContentsId: 202 },
      41,
    );
    expect(nativeWebContents.close).toHaveBeenCalled();
    expect(
      manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId: opened.activeTabId! })
        .webContents,
    ).toBe(guest);
    manager.dispose();
  });

  it("adopts a renderer guest even when attach races ahead of bounds promotion", () => {
    const nativeWebContents = new FakeWebContents(211);
    const nativeView = {
      webContents: nativeWebContents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      setBorderRadius: vi.fn(),
    };
    webContentsViewConstructor.mockReturnValueOnce(nativeView);

    const manager = new DesktopBrowserManager();
    const hostWindow = {
      webContents: Object.assign(new EventEmitter(), { id: 41, isDestroyed: () => false }),
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    };
    manager.setWindow(hostWindow as never);
    const opened = manager.open({ threadId: THREAD_ID });
    manager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "native",
      bounds: { x: 20, y: 40, width: 800, height: 600 },
    });

    const guest = Object.assign(new FakeWebContents(212), {
      getType: () => "webview",
      hostWebContents: hostWindow.webContents,
      session: browserSession,
    });
    fromId.mockReturnValue(guest);
    const attached = manager.attachWebview(
      { threadId: THREAD_ID, tabId: opened.activeTabId!, webContentsId: 212 },
      41,
    );
    expect(attached.tabs.find((tab) => tab.id === opened.activeTabId)?.runtimeSurface).toBe(
      "renderer",
    );
    expect(nativeWebContents.close).toHaveBeenCalled();
    expect(
      manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId: opened.activeTabId! })
        .webContents,
    ).toBe(guest);
    manager.dispose();
  });

  it.each([true, false])(
    "keeps an agent's native page when a stale guest attaches (bounds first: %s)",
    async (boundsFirst) => {
      const nativeWebContents = new FakeWebContents(213);
      const nativeView = {
        webContents: nativeWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
      };
      webContentsViewConstructor.mockReturnValueOnce(nativeView);
      const manager = new DesktopBrowserManager();
      const hostWindow = {
        webContents: Object.assign(new EventEmitter(), { id: 41, isDestroyed: () => false }),
        contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
      };
      manager.setWindow(hostWindow as never);
      try {
        const opened = manager.prepareAutomationTab({
          threadId: THREAD_ID,
          url: "https://example.com",
          reuse: true,
        });
        const target = { threadId: THREAD_ID, tabId: opened.activeTabId! };
        const runtime = await manager.getAutomationRuntime(target, { restore: false });
        const guest = Object.assign(new FakeWebContents(214), {
          getType: () => "webview",
          hostWebContents: hostWindow.webContents,
          session: browserSession,
        });
        fromId.mockReturnValue(guest);
        const staleBounds = () =>
          manager.setPanelBounds({
            threadId: THREAD_ID,
            surface: "renderer",
            bounds: { x: 20, y: 40, width: 800, height: 600 },
          });
        if (boundsFirst) staleBounds();
        const attached = manager.attachWebview({ ...target, webContentsId: 214 }, 41);
        if (!boundsFirst) staleBounds();
        expect(attached.tabs.find((tab) => tab.id === target.tabId)?.runtimeSurface).toBe("native");
        expect(nativeWebContents.close).not.toHaveBeenCalled();
        expect((await manager.getAutomationRuntime(target, { restore: false })).webContents).toBe(
          runtime.webContents,
        );
        expect(manager.getVisibleAutomationRuntime(target).webContents).toBe(nativeWebContents);
        manager.detachWebview({ ...target, webContentsId: 214 });
        expect(nativeWebContents.close).not.toHaveBeenCalled();
      } finally {
        manager.dispose();
      }
    },
  );

  it("creates a native background runtime after the renderer guest detaches", async () => {
    const manager = new DesktopBrowserManager();
    const hostWindow = {
      webContents: Object.assign(new EventEmitter(), { id: 41, isDestroyed: () => false }),
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    };
    manager.setWindow(hostWindow as never);
    const opened = manager.open({ threadId: THREAD_ID });
    const tabId = opened.activeTabId!;
    const guest = Object.assign(new FakeWebContents(213), {
      getType: () => "webview",
      hostWebContents: hostWindow.webContents,
      session: browserSession,
    });
    fromId.mockReturnValue(guest);
    manager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: 213 }, 41);
    manager.selectAutomationTab({ threadId: THREAD_ID, tabId });
    manager.detachWebview({ threadId: THREAD_ID, tabId, webContentsId: 213 });

    const backgroundWebContents = new FakeWebContents(214);
    webContentsViewConstructor.mockReturnValueOnce({
      webContents: backgroundWebContents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
    });
    const runtime = await manager.getAutomationRuntime(
      { threadId: THREAD_ID, tabId },
      { restore: false },
    );
    expect(runtime.webContents).toBe(backgroundWebContents);
    expect(manager.getState({ threadId: THREAD_ID }).tabs[0]?.runtimeSurface).toBe("native");
    manager.dispose();
  });

  it("keeps the adopted renderer guest when agent tools claim the tab", async () => {
    const manager = new DesktopBrowserManager();
    const hostWindow = {
      webContents: Object.assign(new EventEmitter(), { id: 41, isDestroyed: () => false }),
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    };
    manager.setWindow(hostWindow as never);
    const state = manager.open({ threadId: THREAD_ID });
    const tabId = state.activeTabId!;
    const guest = Object.assign(new FakeWebContents(203), {
      getType: () => "webview",
      hostWebContents: hostWindow.webContents,
      session: browserSession,
    });
    fromId.mockReturnValue(guest);
    manager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: 203 }, 41);
    manager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "renderer",
      bounds: { x: 40, y: 80, width: 320, height: 220 },
    });

    manager.selectAutomationTab({ threadId: THREAD_ID, tabId });
    const runtime = await manager.getAutomationRuntime({ threadId: THREAD_ID, tabId });

    expect(runtime.webContents).toBe(guest);
    expect(guest.close).not.toHaveBeenCalled();
    expect(manager.getState({ threadId: THREAD_ID }).tabs[0]?.runtimeSurface).toBe("renderer");
    manager.dispose();
  });
});
