// Register the Electron fixture before the browser runtime imports.
import {
  FakeWebContents,
  THREAD_ID,
  webContentsViewConstructor,
} from "./browserManagerAutomationFixture";

import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { describe, expect, it, vi } from "vitest";
import { DesktopBrowserManager } from "../browserManager";

describe("DesktopBrowserManager automation runtime boundary", () => {
  it("creates a persistent native runtime without mounting the owning chat", async () => {
    webContentsViewConstructor.mockClear();
    const nativeWebContents = new FakeWebContents();
    const setBounds = vi.fn();
    const view = {
      webContents: nativeWebContents,
      setBounds,
      setVisible: vi.fn(),
      setBorderRadius: vi.fn(),
    };
    webContentsViewConstructor.mockReturnValueOnce(view);
    const manager = new DesktopBrowserManager();
    const parent = { addChildView: vi.fn(), removeChildView: vi.fn() };
    manager.setWindow({ contentView: parent } as never);
    const blank = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
    const tabId = blank.activeTabId!;
    manager.prepareAutomationNavigation({
      threadId: THREAD_ID,
      tabId,
      url: "https://agent.example/path",
    });
    const runtime = await manager.getAutomationRuntime(
      { threadId: THREAD_ID, tabId },
      { restore: false },
    );

    expect(webContentsViewConstructor).toHaveBeenCalledOnce();
    expect(runtime.webContents).toBe(nativeWebContents);
    expect(setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1_280, height: 800 });
    expect(parent.addChildView).toHaveBeenLastCalledWith(view, 0);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(manager.getState({ threadId: THREAD_ID }).tabs[0]?.runtimeSurface).toBe("native");
    manager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "native",
      bounds: { x: 200, y: 50, width: 800, height: 600 },
    });
    expect(parent.addChildView).toHaveBeenLastCalledWith(view);
    manager.hide({ threadId: THREAD_ID });
    expect(parent.addChildView).toHaveBeenLastCalledWith(view, 0);
    expect(setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1_280, height: 800 });
    expect(parent.removeChildView.mock.invocationCallOrder.at(-1)).toBeLessThan(
      parent.addChildView.mock.invocationCallOrder.at(-1)!,
    );
    manager.dispose();
  });

  it("does not race host navigation when the owning panel reveals first", async () => {
    const nativeWebContents = Object.assign(new FakeWebContents(), { getURL: () => "" });
    webContentsViewConstructor.mockReturnValueOnce({
      webContents: nativeWebContents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      setBorderRadius: vi.fn(),
    });
    const manager = new DesktopBrowserManager();
    manager.setWindow({
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    } as never);
    const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
    const tabId = prepared.activeTabId!;
    manager.prepareAutomationNavigation({
      threadId: THREAD_ID,
      tabId,
      url: "https://agent.example/path",
    });

    manager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "native",
      bounds: { x: 0, y: 40, width: 900, height: 700 },
    });

    expect(nativeWebContents.loadURL).not.toHaveBeenCalled();
    expect(manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId }).webContents).toBe(
      nativeWebContents,
    );
    await manager.getAutomationRuntime({ threadId: THREAD_ID, tabId }, { restore: false });
    expect(nativeWebContents.loadURL).toHaveBeenCalledOnce();
    expect(nativeWebContents.loadURL).toHaveBeenCalledWith("about:blank");
    manager.dispose();
  });

  it("does not suspend the active agent tab when its chat stays hidden", async () => {
    vi.useFakeTimers();
    try {
      const nativeWebContents = new FakeWebContents();
      webContentsViewConstructor.mockReturnValueOnce({
        webContents: nativeWebContents,
        setBounds: vi.fn(),
      });
      const manager = new DesktopBrowserManager();
      const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
      const tabId = prepared.activeTabId!;

      await manager.getAutomationRuntime({ threadId: THREAD_ID, tabId }, { restore: false });
      manager.hide({ threadId: THREAD_ID });
      await vi.runAllTimersAsync();

      expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(0);
      expect(nativeWebContents.close).not.toHaveBeenCalled();
      expect(manager.getState({ threadId: THREAD_ID }).tabs[0]).toMatchObject({
        id: tabId,
        runtimeSurface: "native",
        status: "live",
      });
      manager.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds hidden automation runtimes globally and restores an evicted tab on demand", async () => {
    vi.useFakeTimers();
    try {
      const nativeWebContents = Array.from(
        { length: 6 },
        (_, index) => new FakeWebContents(100 + index),
      );
      for (const webContents of nativeWebContents) {
        webContentsViewConstructor.mockReturnValueOnce({
          webContents,
          setBounds: vi.fn(),
          setVisible: vi.fn(),
          setBorderRadius: vi.fn(),
        });
      }

      const manager = new DesktopBrowserManager();
      const tabs = [] as Array<{ threadId: ThreadId; tabId: string }>;
      for (let index = 0; index < 5; index += 1) {
        const threadId = ThreadId.makeUnsafe(`thread-background-${index}`);
        const prepared = manager.prepareAutomationTab({ threadId, reuse: true });
        const tabId = prepared.activeTabId!;
        tabs.push({ threadId, tabId });
        await manager.getAutomationRuntime({ threadId, tabId }, { restore: false });
      }

      expect(nativeWebContents.every((webContents) => !webContents.close.mock.calls.length)).toBe(
        true,
      );
      await vi.advanceTimersByTimeAsync(31_001);

      expect(nativeWebContents[0]!.close).toHaveBeenCalledOnce();
      expect(
        nativeWebContents.slice(1, 5).every((webContents) => !webContents.close.mock.calls.length),
      ).toBe(true);
      expect(manager.getState({ threadId: tabs[0]!.threadId }).tabs[0]?.status).toBe("suspended");

      const restored = await manager.getAutomationRuntime(tabs[0]!, { restore: false });
      expect(restored.webContents).toBe(nativeWebContents[5]);
      expect(manager.getState({ threadId: tabs[0]!.threadId }).tabs[0]?.status).toBe("live");

      expect(nativeWebContents[1]!.close).toHaveBeenCalledOnce();
      manager.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
