// Register the Electron fixture before the browser runtime imports.
import {
  browserSession,
  FakeWebContents,
  THREAD_ID,
  willDownloadListener,
} from "./browserManagerAutomationFixture";

import type { WebContents } from "electron";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { DesktopBrowserManager } from "../browserManager";

describe("DesktopBrowserManager automation runtime boundary", () => {
  it("publishes direct native keyboard and mouse takeover from the visible guest", () => {
    const manager = new DesktopBrowserManager();
    const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
    const tabId = prepared.activeTabId!;
    const webContents = new FakeWebContents();
    const runtime = {
      key: `${THREAD_ID}:${tabId}`,
      threadId: THREAD_ID,
      tabId,
      webContents: webContents as unknown as WebContents,
      view: null,
      ownsWebContents: false as const,
      listenerDisposers: [] as Array<() => void>,
    };
    (
      manager as unknown as {
        hostRuntime: { configureRuntimeWebContents(value: typeof runtime): void };
      }
    ).hostRuntime.configureRuntimeWebContents(runtime);
    const takeover = vi.fn();
    const unsubscribe = manager.subscribeAutomationHumanControl(THREAD_ID, takeover);

    webContents.emit(
      "before-input-event",
      { preventDefault: vi.fn() },
      {
        type: "keyDown",
        key: "a",
        meta: false,
        control: false,
        shift: false,
        alt: false,
      },
    );
    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(1);
    expect(takeover).toHaveBeenCalledTimes(1);

    webContents.emit("before-mouse-event", {}, { type: "mouseMove", x: 10, y: 10 });
    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(1);
    webContents.emit(
      "before-mouse-event",
      {},
      {
        type: "mouseDown",
        button: "left",
        x: 10,
        y: 10,
      },
    );
    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(2);
    expect(takeover).toHaveBeenCalledTimes(2);

    unsubscribe();
    webContents.emit("before-mouse-event", {}, { type: "mouseWheel", x: 10, y: 10 });
    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(3);
    expect(takeover).toHaveBeenCalledTimes(2);
  });

  it("consumes only the exact short-lived native inputs registered by browser automation", () => {
    const manager = new DesktopBrowserManager();
    const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
    const tabId = prepared.activeTabId!;
    const webContents = new FakeWebContents();
    const runtime = {
      key: `${THREAD_ID}:${tabId}`,
      threadId: THREAD_ID,
      tabId,
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
    const visible = manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId });

    const releaseKey = visible.expectAgentInput!({
      kind: "key",
      key: "a",
      alt: false,
      control: false,
      meta: false,
      shift: false,
    });
    webContents.emit(
      "before-input-event",
      { preventDefault: vi.fn() },
      {
        type: "keyDown",
        key: "a",
        meta: false,
        control: false,
        shift: false,
        alt: false,
      },
    );
    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(0);
    releaseKey();

    const releasePointer = visible.expectAgentInput!({
      kind: "mouse",
      type: "mouseDown",
      button: "left",
      x: 40,
      y: 50,
    });
    webContents.emit(
      "before-mouse-event",
      {},
      {
        type: "mouseDown",
        button: "left",
        x: 40.4,
        y: 49.6,
      },
    );
    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(0);
    releasePointer();

    const releaseUnmatched = visible.expectAgentInput!({
      kind: "key",
      key: "x",
      alt: false,
      control: false,
      meta: false,
      shift: false,
    });
    webContents.emit(
      "before-input-event",
      { preventDefault: vi.fn() },
      {
        type: "keyDown",
        key: "y",
        meta: false,
        control: false,
        shift: false,
        alt: false,
      },
    );
    webContents.emit(
      "before-mouse-event",
      {},
      {
        type: "mouseDown",
        button: "left",
        x: 400,
        y: 500,
      },
    );
    expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(2);
    releaseUnmatched();
  });

  it("keeps an agent-owned native runtime when its tab is reselected", async () => {
    const manager = new DesktopBrowserManager();
    const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
    const tabId = prepared.activeTabId!;
    const nativeWebContents = new FakeWebContents();
    const nativeRuntime = {
      key: `${THREAD_ID}:${tabId}`,
      threadId: THREAD_ID,
      tabId,
      webContents: nativeWebContents as unknown as WebContents,
      view: {},
      ownsWebContents: true as const,
      listenerDisposers: [] as Array<() => void>,
    };
    const access = (
      manager as unknown as {
        hostRuntime: {
          runtimes: Map<string, typeof nativeRuntime>;
        };
      }
    ).hostRuntime;
    access.runtimes.set(nativeRuntime.key, nativeRuntime);

    manager.selectAutomationTab({ threadId: THREAD_ID, tabId });
    const acquired = await manager.getAutomationRuntime({ threadId: THREAD_ID, tabId });

    expect(acquired.webContents).toBe(nativeWebContents);
    expect(nativeWebContents.close).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("contains delayed agent downloads until human control advances the runtime epoch", () => {
    const manager = new DesktopBrowserManager();
    const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
    const tabId = prepared.activeTabId!;
    const webContents = new FakeWebContents();
    const runtime = {
      key: `${THREAD_ID}:${tabId}`,
      threadId: THREAD_ID,
      tabId,
      webContents: webContents as unknown as WebContents,
      view: null,
      ownsWebContents: false as const,
      listenerDisposers: [] as Array<() => void>,
    };
    const access = (
      manager as unknown as {
        hostRuntime: {
          runtimes: Map<string, typeof runtime>;
          automationSideEffectProvenanceByRuntimeKey: Map<string, unknown>;
          configureRuntimeWebContents(value: typeof runtime): void;
        };
      }
    ).hostRuntime;
    access.runtimes.set(runtime.key, runtime);
    access.configureRuntimeWebContents(runtime);
    const observed = vi.fn();
    const release = manager.trackAutomationDownload({ threadId: THREAD_ID, tabId }, observed);
    const agentEvent = { preventDefault: vi.fn() };

    willDownloadListener.current?.(agentEvent, {}, webContents);

    expect(agentEvent.preventDefault).toHaveBeenCalledOnce();
    expect(observed).toHaveBeenCalledWith({ threadId: THREAD_ID, sourceTabId: tabId });
    expect(agentEvent.preventDefault.mock.invocationCallOrder[0]).toBeLessThan(
      observed.mock.invocationCallOrder[0]!,
    );

    const foreignEvent = { preventDefault: vi.fn() };
    willDownloadListener.current?.(foreignEvent, {}, new FakeWebContents(99));
    expect(foreignEvent.preventDefault).not.toHaveBeenCalled();

    release();
    expect(access.automationSideEffectProvenanceByRuntimeKey.size).toBe(1);
    const delayedAgentEvent = { preventDefault: vi.fn() };
    willDownloadListener.current?.(delayedAgentEvent, {}, webContents);
    expect(delayedAgentEvent.preventDefault).toHaveBeenCalledOnce();

    expect(observed).toHaveBeenCalledOnce();

    webContents.emit(
      "before-mouse-event",
      {},
      {
        type: "mouseDown",
        button: "left",
        x: 200,
        y: 200,
      },
    );
    const afterHumanTakeoverEvent = { preventDefault: vi.fn() };
    willDownloadListener.current?.(afterHumanTakeoverEvent, {}, webContents);
    expect(afterHumanTakeoverEvent.preventDefault).not.toHaveBeenCalled();
    expect(access.automationSideEffectProvenanceByRuntimeKey.size).toBe(0);

    const releaseSecondAction = manager.trackAutomationDownload(
      { threadId: THREAD_ID, tabId },
      vi.fn(),
    );
    releaseSecondAction();
    expect(access.automationSideEffectProvenanceByRuntimeKey.size).toBe(1);
    manager.closeAutomationTab({ threadId: THREAD_ID, tabId });
    expect(access.automationSideEffectProvenanceByRuntimeKey.size).toBe(0);

    manager.dispose();
    expect(browserSession.removeListener).toHaveBeenCalledWith(
      "will-download",
      expect.any(Function),
    );
  });

  it.each([0.5, 1, 1.25, 2])(
    "correlates delayed CDP clicks with native coordinates at zoom %s",
    async (zoom) => {
      // Event-loop contention must not turn this coordinate test into a grace-period expiry test.
      const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
      try {
        const manager = new DesktopBrowserManager();
        const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
        const tabId = prepared.activeTabId!;
        const webContents = new FakeWebContents();
        webContents.getZoomFactor = () => zoom;
        const sendCommand = vi.fn(async (method: string, params: Record<string, unknown>) => {
          if (method === "Input.dispatchMouseEvent" && params.type === "mousePressed") {
            setImmediate(() => {
              webContents.emit(
                "before-mouse-event",
                {},
                {
                  type: "mouseDown",
                  button: params.button,
                  x: Number(params.x) * zoom,
                  y: Number(params.y) * zoom,
                },
              );
            });
          }
          return {};
        });
        Object.assign(webContents, {
          debugger: Object.assign(new EventEmitter(), {
            isAttached: () => true,
            detach: vi.fn(),
            sendCommand,
          }),
        });
        const runtime = {
          key: `${THREAD_ID}:${tabId}`,
          threadId: THREAD_ID,
          tabId,
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
        const visible = manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId });

        const release = visible.expectAgentInput?.({
          kind: "mouse",
          type: "mouseDown",
          button: "left",
          x: 320,
          y: 48,
        });
        await visible.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
          type: "mousePressed",
          button: "left",
          x: 320,
          y: 48,
        });
        release?.();
        await new Promise((resolve) => setImmediate(resolve));

        expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(0);

        // The expected native signal is one-shot. A second otherwise identical click is genuine human input
        // and must still interrupt automation.
        webContents.emit(
          "before-mouse-event",
          {},
          {
            type: "mouseDown",
            button: "left",
            x: 320 * zoom,
            y: 48 * zoom,
          },
        );
        expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(1);
      } finally {
        clock.mockRestore();
      }
    },
  );

  it("expires a released native-input correlation instead of masking a later matching click", () => {
    const dateNow = vi.spyOn(Date, "now");
    let now = 10_000;
    dateNow.mockImplementation(() => now);
    try {
      const manager = new DesktopBrowserManager();
      const prepared = manager.prepareAutomationTab({ threadId: THREAD_ID, reuse: true });
      const tabId = prepared.activeTabId!;
      const webContents = new FakeWebContents();
      const runtime = {
        key: `${THREAD_ID}:${tabId}`,
        threadId: THREAD_ID,
        tabId,
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
      const visible = manager.getVisibleAutomationRuntime({ threadId: THREAD_ID, tabId });
      const release = visible.expectAgentInput!({
        kind: "mouse",
        type: "mouseDown",
        button: "left",
        x: 320,
        y: 48,
      });

      release();
      now += 101;
      webContents.emit(
        "before-mouse-event",
        {},
        {
          type: "mouseDown",
          button: "left",
          x: 320,
          y: 48,
        },
      );

      expect(manager.getAutomationHumanControlEpoch(THREAD_ID)).toBe(1);
    } finally {
      dateNow.mockRestore();
    }
  });
});
