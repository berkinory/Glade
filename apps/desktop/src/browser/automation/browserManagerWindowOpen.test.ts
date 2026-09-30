// Register the Electron fixture before the browser runtime imports.
import {
  FakeWebContents,
  THREAD_ID,
  webContentsViewConstructor,
} from "./browserManagerAutomationFixture";

import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { DesktopBrowserManager } from "../browserManager";

describe("DesktopBrowserManager automation runtime boundary", () => {
  it("routes an agent-triggered target=_blank tab after the native handler returns", async () => {
    const manager = new DesktopBrowserManager();
    const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
    const sourceTabId = prepared.activeTabId!;
    const webContents = new FakeWebContents();
    const runtime = {
      key: `${THREAD_ID}:${sourceTabId}`,
      threadId: THREAD_ID,
      tabId: sourceTabId,
      webContents: webContents as unknown as WebContents,
      view: null,
      ownsWebContents: false as const,
      listenerDisposers: [] as Array<() => void>,
    };
    const access = (
      manager as unknown as {
        hostRuntime: {
          runtimes: Map<string, typeof runtime>;
          configureRuntimeWebContents(value: typeof runtime): void;
        };
      }
    ).hostRuntime;
    access.runtimes.set(runtime.key, runtime);
    access.configureRuntimeWebContents(runtime);
    const visible = manager.getVisibleAutomationRuntime({
      threadId: THREAD_ID,
      tabId: sourceTabId,
    });
    const releaseGesture = visible.expectAgentInput!({
      kind: "mouse",
      type: "mouseDown",
      button: "left",
      x: 10,
      y: 20,
    });
    const windowOpenEvents: Array<{ kind: string; openedTabId: string | null }> = [];
    const releaseWindowOpenTracking = manager.trackAutomationWindowOpen(
      { threadId: THREAD_ID, tabId: sourceTabId },
      (event) => {
        windowOpenEvents.push(event);
      },
    );

    releaseGesture();

    let windowOpenHandlerReturned = false;
    const reentrantStateEmission = vi.fn();
    const openedTabStateEmission = vi.fn();
    manager.subscribe((state) => {
      if (state.tabs.length <= 1) return;
      openedTabStateEmission();
      if (!windowOpenHandlerReturned) reentrantStateEmission();
    });
    expect(
      webContents.windowOpenHandler?.({
        url: "https://opened.example/path",
        frameName: "",
        features: "",
        disposition: "foreground-tab",
      }),
    ).toEqual({ action: "deny" });
    windowOpenHandlerReturned = true;
    expect(manager.getState({ threadId: THREAD_ID }).tabs).toHaveLength(1);

    webContents.windowOpenHandler?.({
      url: "https://opened.example/path",
      frameName: "",
      features: "",
      disposition: "foreground-tab",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(manager.getState({ threadId: THREAD_ID }).tabs).toHaveLength(1);
    expect(windowOpenEvents).toEqual([
      expect.objectContaining({
        kind: "tab",
        sourceTabId,
        threadId: THREAD_ID,
      }),
    ]);
    releaseWindowOpenTracking();
    const afterAgentOpen = manager.getState({ threadId: THREAD_ID });
    expect(afterAgentOpen.tabs).toHaveLength(2);
    expect(afterAgentOpen.activeTabId).not.toBe(sourceTabId);
    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(0);
    expect(windowOpenEvents).toEqual([
      {
        kind: "tab",
        openedTabId: afterAgentOpen.activeTabId,
        sourceTabId,
        threadId: THREAD_ID,
      },
    ]);
    expect(openedTabStateEmission).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(openedTabStateEmission).toHaveBeenCalledOnce();
    expect(reentrantStateEmission).not.toHaveBeenCalled();

    webContents.windowOpenHandler?.({
      url: "https://manual.example/path",
      frameName: "",
      features: "",
      disposition: "foreground-tab",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(1);
  });

  it.each(["script", "opener", "before-publish"])(
    "embeds an OAuth popup and handles %s closure",
    async (closure) => {
      const manager = new DesktopBrowserManager();
      const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
      const sourceTabId = prepared.activeTabId!;
      const webContents = new FakeWebContents();
      const runtime = {
        key: `${THREAD_ID}:${sourceTabId}`,
        threadId: THREAD_ID,
        tabId: sourceTabId,
        webContents: webContents as unknown as WebContents,
        view: null,
        ownsWebContents: false as const,
        listenerDisposers: [] as Array<() => void>,
      };
      const access = (
        manager as unknown as {
          hostRuntime: {
            runtimes: Map<string, typeof runtime>;
            configureRuntimeWebContents(value: typeof runtime): void;
          };
        }
      ).hostRuntime;
      access.runtimes.set(runtime.key, runtime);
      access.configureRuntimeWebContents(runtime);
      const observed = vi.fn();
      const release = manager.trackAutomationWindowOpen(
        { threadId: THREAD_ID, tabId: sourceTabId },
        observed,
      );

      const response = webContents.windowOpenHandler?.({
        url: "https://accounts.google.com/o/oauth2/auth",
        frameName: "_blank",
        features: "width=480,height=640",
        disposition: "foreground-tab",
      });
      expect(response).toMatchObject({ action: "allow", createWindow: expect.any(Function) });
      expect(observed).toHaveBeenCalledOnce();
      expect(observed).toHaveBeenCalledWith({
        threadId: THREAD_ID,
        sourceTabId,
        kind: "popup",
        openedTabId: null,
      });
      expect(manager.getState({ threadId: THREAD_ID }).tabs).toHaveLength(1);
      expect(manager.getState({ threadId: THREAD_ID }).activeTabId).toBe(sourceTabId);

      const child = new FakeWebContents(120);
      const view = {
        webContents: child,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
      };
      webContentsViewConstructor.mockReturnValueOnce(view);
      const preferences = { contextIsolation: true, sandbox: true, nodeIntegration: false };
      const popupOptions = {
        webContents: child as unknown as WebContents,
        webPreferences: preferences,
      };
      expect(response!.createWindow!(popupOptions)).toBe(child);
      expect(webContentsViewConstructor).toHaveBeenLastCalledWith(
        expect.objectContaining({
          webContents: child,
          webPreferences: expect.objectContaining(preferences),
        }),
      );
      expect(manager.getState({ threadId: THREAD_ID }).activeTabId).toBe(sourceTabId);
      if (closure === "before-publish") {
        manager.closeAutomationTab({ threadId: THREAD_ID, tabId: sourceTabId });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(manager.getState({ threadId: THREAD_ID }).tabs).toHaveLength(0);
        expect(child.close).toHaveBeenCalledOnce();
        release();
        manager.dispose();
        return;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      const popupState = manager.getState({ threadId: THREAD_ID });
      expect(popupState.tabs).toHaveLength(2);
      expect(popupState.tabs.find((tab) => tab.id === popupState.activeTabId)).toMatchObject({
        openerTabId: sourceTabId,
        runtimeSurface: "native",
        status: "live",
      });
      expect(child.loadURL).not.toHaveBeenCalled();
      expect(child.windowOpenHandler).toBeTypeOf("function");
      expect(
        child.windowOpenHandler?.({
          url: "file:///private/fixture",
          frameName: "",
          features: "",
          disposition: "new-window",
        }),
      ).toEqual({ action: "deny" });

      vi.useFakeTimers();
      try {
        manager.hide({ threadId: THREAD_ID });
        await vi.advanceTimersByTimeAsync(60_001);
        expect(child.close).not.toHaveBeenCalled();
        expect(webContents.close).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }

      if (closure === "opener") {
        manager.closeAutomationTab({ threadId: THREAD_ID, tabId: sourceTabId });
        expect(manager.getState({ threadId: THREAD_ID }).tabs).toHaveLength(0);
        expect(child.close).toHaveBeenCalledOnce();
        release();
        manager.dispose();
        return;
      }

      const humanEpoch = manager.getAutomationHumanControlEpoch(THREAD_ID);
      const closeEvent = { preventDefault: vi.fn() };
      child.emit("close", closeEvent);
      expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
      expect(manager.getState({ threadId: THREAD_ID }).tabs).toHaveLength(1);
      expect(manager.getState({ threadId: THREAD_ID }).activeTabId).toBe(sourceTabId);
      expect(child.close).toHaveBeenCalledOnce();
      expect(webContents.close).not.toHaveBeenCalled();
      expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(humanEpoch);

      release();
      manager.dispose();
    },
  );

  it("cancels a deferred window-open when its source tab or manager is torn down", async () => {
    for (const teardown of ["tab", "manager"] as const) {
      const manager = new DesktopBrowserManager();
      const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
      const sourceTabId = prepared.activeTabId!;
      const webContents = new FakeWebContents();
      const runtime = {
        key: `${THREAD_ID}:${sourceTabId}`,
        threadId: THREAD_ID,
        tabId: sourceTabId,
        webContents: webContents as unknown as WebContents,
        view: null,
        ownsWebContents: false as const,
        listenerDisposers: [] as Array<() => void>,
      };
      const access = (
        manager as unknown as {
          hostRuntime: {
            runtimes: Map<string, typeof runtime>;
            pendingWindowOpenTasksByRuntimeKey: Map<string, unknown>;
            pendingAutomationWindowOpenCommitsByRuntimeKey: Map<string, unknown>;
            states: Map<typeof THREAD_ID, unknown>;
            configureRuntimeWebContents(value: typeof runtime): void;
          };
        }
      ).hostRuntime;
      access.runtimes.set(runtime.key, runtime);
      access.configureRuntimeWebContents(runtime);
      const opened = vi.fn();
      const releaseTracking = manager.trackAutomationWindowOpen(
        { threadId: THREAD_ID, tabId: sourceTabId },
        opened,
      );

      webContents.windowOpenHandler?.({
        url: "https://stale.example/",
        frameName: "",
        features: "",
        disposition: "foreground-tab",
      });
      expect(access.pendingWindowOpenTasksByRuntimeKey.size).toBe(1);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(access.pendingWindowOpenTasksByRuntimeKey.size).toBe(0);
      expect(access.pendingAutomationWindowOpenCommitsByRuntimeKey.size).toBe(1);
      expect(manager.getState({ threadId: THREAD_ID }).tabs).toHaveLength(1);
      if (teardown === "tab") {
        manager.closeAutomationTab({ threadId: THREAD_ID, tabId: sourceTabId });
      } else {
        manager.dispose();
      }
      expect(access.pendingWindowOpenTasksByRuntimeKey.size).toBe(0);
      expect(access.pendingAutomationWindowOpenCommitsByRuntimeKey.size).toBe(0);

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(opened).toHaveBeenCalledOnce();
      if (teardown === "tab") {
        expect(manager.getState({ threadId: THREAD_ID }).tabs).toHaveLength(0);
      } else {
        expect(access.states.size).toBe(0);
      }
      releaseTracking();
    }
  });
});
