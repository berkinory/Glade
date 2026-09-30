// Register the Electron fixture before the browser runtime imports.
import {
  browserSession,
  FakeWebContents,
  fromId,
  THREAD_ID,
} from "./browserManagerAutomationFixture";

import type { WebContents } from "electron";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { DesktopBrowserManager } from "../browserManager";

describe("DesktopBrowserManager automation runtime boundary", () => {
  it("refuses a detached native fallback and returns an adopted renderer webview", () => {
    const manager = new DesktopBrowserManager();
    const state = manager.open({ threadId: THREAD_ID });
    const tabId = state.activeTabId;
    expect(tabId).not.toBeNull();
    if (!tabId) return;

    const webContents = new FakeWebContents();
    const access = (
      manager as unknown as {
        hostRuntime: {
          runtimes: Map<
            string,
            {
              key: string;
              threadId: typeof THREAD_ID;
              tabId: string;
              webContents: WebContents;
              view: object | null;
              ownsWebContents: boolean;
              listenerDisposers: Array<() => void>;
            }
          >;
        };
      }
    ).hostRuntime;
    const key = `${THREAD_ID}:${tabId}`;
    access.runtimes.set(key, {
      key,
      threadId: THREAD_ID,
      tabId,
      webContents: webContents as unknown as WebContents,
      view: {},
      ownsWebContents: true,
      listenerDisposers: [],
    });

    expect(() => manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId })).toThrow(
      /not currently visible/i,
    );

    access.runtimes.set(key, {
      key,
      threadId: THREAD_ID,
      tabId,
      webContents: webContents as unknown as WebContents,
      view: null,
      ownsWebContents: false,
      listenerDisposers: [],
    });
    expect(manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId }).webContents).toBe(
      webContents,
    );
  });

  it("marks prepared agent tabs for a persistent native runtime", () => {
    const manager = new DesktopBrowserManager();
    const state = manager.prepareAutomationTab({
      threadId: THREAD_ID,
      url: "https://example.test",
      reuse: false,
    });

    expect(state.open).toBe(true);
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe(state.tabs.at(-1)?.id);
    expect(state.tabs[0]?.runtimeSurface).toBe("native");
    expect(() =>
      manager.getVisibleAutomationRuntime({
        threadId: THREAD_ID,
        tabId: state.activeTabId!,
      }),
    ).toThrow(/not ready yet/i);
  });

  it("adopts only a webview owned by the exact Glade window and browser partition", () => {
    const manager = new DesktopBrowserManager();
    const state = manager.open({ threadId: THREAD_ID });
    const tabId = state.activeTabId!;
    const guest = Object.assign(new FakeWebContents(), {
      getType: () => "webview",
      hostWebContents: { id: 41 },
      session: browserSession,
    });
    fromId.mockReturnValue(guest);

    expect(
      manager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: guest.id }, 41),
    ).toMatchObject({ activeTabId: tabId });
    expect(manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId }).webContents).toBe(
      guest,
    );

    fromId.mockReturnValue({ ...guest, getType: () => "window" });
    expect(() =>
      manager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: guest.id }, 41),
    ).toThrow(/does not belong/i);
    fromId.mockReturnValue({ ...guest, hostWebContents: { id: 99 } });
    expect(() =>
      manager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: guest.id }, 41),
    ).toThrow(/does not belong/i);
    fromId.mockReturnValue({ ...guest, session: {} });
    expect(() =>
      manager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: guest.id }, 41),
    ).toThrow(/does not belong/i);
  });

  it("routes automation only after the adopted renderer guest is the visible panel surface", () => {
    const manager = new DesktopBrowserManager();
    const hostWindow = {
      webContents: Object.assign(new EventEmitter(), { id: 41, isDestroyed: () => false }),
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    };
    manager.setWindow(hostWindow as never);
    const state = manager.open({ threadId: THREAD_ID });
    const tabId = state.activeTabId!;
    const guest = Object.assign(new FakeWebContents(), {
      getType: () => "webview",
      hostWebContents: hostWindow.webContents,
      session: browserSession,
    });
    fromId.mockReturnValue(guest);

    manager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: guest.id }, 41);
    expect(() => manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId })).toThrow(
      /not currently visible/i,
    );

    manager.setPanelBounds({
      threadId: THREAD_ID,
      surface: "renderer",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });
    expect(manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId }).webContents).toBe(
      guest,
    );

    manager.setPanelBounds({ threadId: THREAD_ID, surface: "renderer", bounds: null });
    expect(manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId }).webContents).toBe(
      guest,
    );
  });

  it("rejects stale or duplicate renderer bindings instead of stealing visible tab affinity", () => {
    const manager = new DesktopBrowserManager();
    const state = manager.open({ threadId: THREAD_ID });
    const tabId = state.activeTabId!;
    const firstGuest = Object.assign(new FakeWebContents(17), {
      getType: () => "webview",
      hostWebContents: { id: 41 },
      session: browserSession,
    });
    const duplicateGuest = Object.assign(new FakeWebContents(18), {
      getType: () => "webview",
      hostWebContents: { id: 41 },
      session: browserSession,
    });
    fromId.mockReturnValue(firstGuest);
    manager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: firstGuest.id }, 41);

    fromId.mockReturnValue(duplicateGuest);
    expect(() =>
      manager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: duplicateGuest.id }, 41),
    ).toThrow(/already attached to another visible webview/i);
    expect(manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId }).webContents).toBe(
      firstGuest,
    );

    const second = manager.newTab({
      threadId: THREAD_ID,
      url: "https://second.example/",
    });
    const secondTabId = second.activeTabId!;
    expect(() =>
      manager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: duplicateGuest.id }, 41),
    ).toThrow(/active tab/i);
    expect(secondTabId).not.toBe(tabId);
  });

  it("keeps the CDP session when one renderer webview is rebound to another tab", () => {
    const manager = new DesktopBrowserManager();
    const first = manager.open({ threadId: THREAD_ID });
    const firstTabId = first.activeTabId!;
    const detachDebugger = vi.fn();
    const guest = Object.assign(new FakeWebContents(), {
      debugger: { isAttached: () => true, detach: detachDebugger },
      getType: () => "webview",
      hostWebContents: { id: 41 },
      session: browserSession,
    });
    fromId.mockReturnValue(guest);
    manager.attachWebview(
      {
        threadId: THREAD_ID,
        tabId: firstTabId,
        webContentsId: guest.id,
      },
      41,
    );

    const second = manager.newTab({
      threadId: THREAD_ID,
      url: "https://second.example/",
    });
    const secondTabId = second.activeTabId!;
    manager.attachWebview(
      {
        threadId: THREAD_ID,
        tabId: secondTabId,
        webContentsId: guest.id,
      },
      41,
    );

    expect(detachDebugger).not.toHaveBeenCalled();
    expect(
      manager.getVisibleAutomationRuntime({
        threadId: THREAD_ID,
        tabId: secondTabId,
      }).webContents,
    ).toBe(guest);
  });

  it("detaches CDP and defers publication before removing the final renderer webview", async () => {
    const manager = new DesktopBrowserManager();
    const state = manager.open({ threadId: THREAD_ID });
    const tabId = state.activeTabId!;
    const detachDebugger = vi.fn();
    const guest = Object.assign(new FakeWebContents(), {
      debugger: { isAttached: () => true, detach: detachDebugger },
      getType: () => "webview",
      hostWebContents: { id: 41 },
      session: browserSession,
    });
    fromId.mockReturnValue(guest);
    manager.attachWebview({ threadId: THREAD_ID, tabId, webContentsId: guest.id }, 41);
    const publication = vi.fn();
    manager.subscribe(publication);

    manager.closeAutomationTab({ threadId: THREAD_ID, tabId });

    expect(detachDebugger).toHaveBeenCalledOnce();
    expect(guest.close).not.toHaveBeenCalled();
    expect(guest.loadURL).not.toHaveBeenCalled();
    expect(publication).not.toHaveBeenCalled();
    expect(manager.getState({ threadId: THREAD_ID })).toMatchObject({
      activeTabId: null,
      tabs: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(guest.loadURL).toHaveBeenCalledWith("about:blank");
    expect(publication).toHaveBeenCalledWith(
      expect.objectContaining({
        activeTabId: null,
        tabs: [],
      }),
    );
  });

  it("projects navigation from the blank launcher before a renderer guest attaches", () => {
    const manager = new DesktopBrowserManager();
    const opened = manager.prepareAutomationTab({
      threadId: THREAD_ID,
      reuse: true,
    });
    const tabId = opened.activeTabId!;

    const projected = manager.prepareAutomationNavigation({
      threadId: THREAD_ID,
      tabId,
      url: "https://docs.example/path",
    });

    expect(projected.activeTabId).toBe(tabId);
    expect(projected.tabs[0]?.url).toBe("https://docs.example/path");
    expect(() => manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId })).toThrow(
      /not ready yet/i,
    );
  });

  it("separates dedicated agent projection from manual browser control epochs", () => {
    const manager = new DesktopBrowserManager();
    const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
    const tabId = prepared.activeTabId!;
    manager.prepareAutomationNavigation({
      threadId: THREAD_ID,
      tabId,
      url: "https://agent.example",
    });
    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(0);

    manager.open({ threadId: THREAD_ID });
    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(0);

    manager.navigate({ threadId: THREAD_ID, tabId, url: "https://human.example" });
    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(1);
  });

  it("does not republish browser state when automation reselects the already active tab", () => {
    const manager = new DesktopBrowserManager();
    const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
    const tabId = prepared.activeTabId!;
    const publication = vi.fn();
    manager.subscribe(publication);

    const selected = manager.selectAutomationTab({ threadId: THREAD_ID, tabId });

    expect(selected.version).toBe(prepared.version);
    expect(publication).not.toHaveBeenCalled();
  });

  it("still treats hiding a manual browser panel as human takeover", () => {
    const manager = new DesktopBrowserManager();
    manager.open({ threadId: THREAD_ID });
    const beforeHide = manager.getAutomationHumanControlEpoch(THREAD_ID);

    manager.hide({ threadId: THREAD_ID });

    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(beforeHide + 1);
  });
});
