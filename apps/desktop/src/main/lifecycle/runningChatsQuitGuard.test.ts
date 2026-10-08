import { afterEach, describe, expect, it, vi } from "vitest";

import {
  makeRunningChatsQuitGuard,
  parseQuitConfirmationRequest,
  parseQuitConfirmationResponse,
  shouldPromptForRunningChatsBeforeQuit,
} from "./runningChatsQuitGuard";

const unexpectedNativeConfirmation = () =>
  Promise.reject(new Error("unexpected native confirmation"));

describe("running chats quit guard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prompts only for user-initiated window close and before-quit", () => {
    expect(shouldPromptForRunningChatsBeforeQuit("window-close")).toBe(true);
    expect(shouldPromptForRunningChatsBeforeQuit("before-quit")).toBe(true);
    expect(shouldPromptForRunningChatsBeforeQuit("SIGINT")).toBe(false);
    expect(shouldPromptForRunningChatsBeforeQuit("fatal startup (bootstrap)")).toBe(false);
    expect(shouldPromptForRunningChatsBeforeQuit("custom-title-bar-relaunch")).toBe(false);
  });

  it("parses quit requests", () => {
    expect(parseQuitConfirmationRequest(null)).toBeNull();
    expect(parseQuitConfirmationRequest({ requestId: " " })).toBeNull();
    expect(parseQuitConfirmationRequest({ requestId: "q1" })).toEqual({
      requestId: "q1",
      presentation: "in-app",
    });
  });

  it("rejects malformed renderer replies", () => {
    expect(parseQuitConfirmationResponse(null)).toBeNull();
    expect(parseQuitConfirmationResponse({ phase: "decision", allow: true })).toBeNull();
    expect(
      parseQuitConfirmationResponse({ requestId: "q1", phase: "ready", runningCount: "2" }),
    ).toBeNull();
  });

  it("parses ready replies with the running chat list", () => {
    expect(
      parseQuitConfirmationResponse({
        requestId: "q1",
        phase: "ready",
        runningCount: 1,
        chats: [{ id: "a", title: "Fix the tray" }, { id: 2 }],
      }),
    ).toEqual({
      requestId: "q1",
      phase: "ready",
      runningCount: 1,
      chats: [{ id: "a", title: "Fix the tray" }],
    });
  });

  it("asks natively once when the renderer is unavailable, and a cancel or failure stays", async () => {
    const guard = makeRunningChatsQuitGuard(() => "q1");
    const send = vi.fn();
    let answer: (allow: boolean) => void = () => undefined;
    const confirmWithoutRenderer = vi.fn(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
    );
    const ask = () =>
      guard.askRenderer({ send, isRendererAvailable: () => false, confirmWithoutRenderer });

    const first = ask();
    const second = ask();
    await Promise.resolve();
    answer(false);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(confirmWithoutRenderer).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();

    await expect(
      guard.askRenderer({
        send,
        isRendererAvailable: () => false,
        confirmWithoutRenderer: () => Promise.reject(new Error("dialog failed")),
      }),
    ).resolves.toBe(false);
    expect(guard.hasAllowedQuit()).toBe(false);
  });

  it("allows quit when the renderer reports no running chats", async () => {
    const guard = makeRunningChatsQuitGuard(() => "q1");
    const send = vi.fn();
    const decision = guard.askRenderer({
      send,
      isRendererAvailable: () => true,
      confirmWithoutRenderer: unexpectedNativeConfirmation,
    });

    expect(send).toHaveBeenCalledWith({ requestId: "q1", presentation: "in-app" });
    guard.receiveResponse({ requestId: "q1", phase: "decision", allow: true });
    await expect(decision).resolves.toBe(true);
    expect(guard.hasAllowedQuit()).toBe(true);
  });

  it("stays when the user declines, then can prompt again", async () => {
    const guard = makeRunningChatsQuitGuard(() => "q1");
    const first = guard.askRenderer({
      send: vi.fn(),
      isRendererAvailable: () => true,
      confirmWithoutRenderer: unexpectedNativeConfirmation,
    });
    guard.receiveResponse({ requestId: "q1", phase: "ready", runningCount: 2 });
    guard.receiveResponse({ requestId: "q1", phase: "decision", allow: false });
    await expect(first).resolves.toBe(false);
    expect(guard.hasAllowedQuit()).toBe(false);

    const second = guard.askRenderer({
      send: vi.fn(),
      isRendererAvailable: () => true,
      confirmWithoutRenderer: unexpectedNativeConfirmation,
    });
    guard.receiveResponse({ requestId: "q1", phase: "decision", allow: true });
    await expect(second).resolves.toBe(true);
  });

  it("coalesces overlapping quit asks onto one renderer request", async () => {
    const guard = makeRunningChatsQuitGuard(() => "q1");
    const send = vi.fn();
    const first = guard.askRenderer({
      send,
      isRendererAvailable: () => true,
      confirmWithoutRenderer: unexpectedNativeConfirmation,
    });
    const second = guard.askRenderer({
      send,
      isRendererAvailable: () => true,
      confirmWithoutRenderer: unexpectedNativeConfirmation,
    });

    expect(send).toHaveBeenCalledOnce();
    guard.receiveResponse({ requestId: "q1", phase: "decision", allow: false });
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
  });

  it("asks natively if the renderer never acknowledges the request", async () => {
    vi.useFakeTimers();
    const guard = makeRunningChatsQuitGuard(() => "q1");
    const confirmWithoutRenderer = vi.fn(async () => true);
    const decision = guard.askRenderer({
      send: vi.fn(),
      isRendererAvailable: () => true,
      confirmWithoutRenderer,
      readyTimeoutMs: 50,
    });

    await vi.advanceTimersByTimeAsync(50);
    await expect(decision).resolves.toBe(true);
    expect(confirmWithoutRenderer).toHaveBeenCalledOnce();
  });

  it("does not time out after the renderer says chats are running", async () => {
    vi.useFakeTimers();
    const guard = makeRunningChatsQuitGuard(() => "q1");
    const decision = guard.askRenderer({
      send: vi.fn(),
      isRendererAvailable: () => true,
      confirmWithoutRenderer: unexpectedNativeConfirmation,
      readyTimeoutMs: 50,
    });
    guard.receiveResponse({ requestId: "q1", phase: "ready", runningCount: 1 });

    await vi.advanceTimersByTimeAsync(200);
    guard.receiveResponse({ requestId: "q1", phase: "decision", allow: false });
    await expect(decision).resolves.toBe(false);
  });

  it("moves a pending ask to the native confirmation when the renderer dies", async () => {
    const requestIds = ["q1", "q2"];
    const guard = makeRunningChatsQuitGuard(() => requestIds.shift() ?? "unexpected");
    const first = guard.askRenderer({
      send: vi.fn(),
      isRendererAvailable: () => true,
      confirmWithoutRenderer: async () => false,
    });

    const decision = guard.rendererGone();
    expect(decision).toBe(first);
    await expect(first).resolves.toBe(false);
    expect(guard.rendererGone()).toBeNull();
    expect(guard.hasAllowedQuit()).toBe(false);

    const send = vi.fn();
    const second = guard.askRenderer({
      send,
      isRendererAvailable: () => true,
      confirmWithoutRenderer: unexpectedNativeConfirmation,
    });
    expect(send).toHaveBeenCalledWith({ requestId: "q2", presentation: "in-app" });
    guard.receiveResponse({ requestId: "q2", phase: "decision", allow: true });
    await expect(second).resolves.toBe(true);
  });

  it("cancels a pending decision when the renderer is replaced and can prompt again", async () => {
    const requestIds = ["q1", "q2"];
    const guard = makeRunningChatsQuitGuard(() => requestIds.shift() ?? "unexpected");
    const first = guard.askRenderer({
      send: vi.fn(),
      isRendererAvailable: () => true,
      confirmWithoutRenderer: unexpectedNativeConfirmation,
    });
    guard.receiveResponse({ requestId: "q1", phase: "ready", runningCount: 1 });

    guard.cancelPending();

    await expect(first).resolves.toBe(false);
    const send = vi.fn();
    const second = guard.askRenderer({
      send,
      isRendererAvailable: () => true,
      confirmWithoutRenderer: unexpectedNativeConfirmation,
    });
    expect(send).toHaveBeenCalledWith({ requestId: "q2", presentation: "in-app" });
    guard.receiveResponse({ requestId: "q2", phase: "decision", allow: true });
    await expect(second).resolves.toBe(true);
  });
});
