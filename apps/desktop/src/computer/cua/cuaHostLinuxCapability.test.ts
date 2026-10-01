import {
  CUA_NATIVE_REVISION,
  cuaRequest as rawCuaRequest,
  type CuaReply,
} from "@glade/shared/computer/cuaDriverProtocol";
import { describe, expect, it } from "vitest";
import { CuaDriverHost } from "./cuaDriverHost";
import { capability, cuaRequest, fixture, waitForEvent } from "./cuaHostFixture";
import type { ComputerInputMonitorState } from "./escapeKillSwitchMonitor";
describe("verified Linux browser input capability", () => {
  const task = { threadId: "linux-browser", turnId: "turn" };
  async function linuxFixture(options: Parameters<typeof fixture>[1] = {}) {
    return fixture(capability, {
      platform: "linux",
      unpatched: true,
      nativeRevision: null,
      reportedRevision: CUA_NATIVE_REVISION,
      browserInputControl: 1,
      inputMonitorState: () => ({ ready: true }),
      ...options,
    });
  }

  it.each([
    { browserInputControl: undefined },
    { browserInputControl: true },
    { browserInputControl: "1" },
    { reportedRevision: CUA_NATIVE_REVISION - 1 },
  ])("refuses browser input with an unverified child capability %j", async (options) => {
    const f = await linuxFixture(options);
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      args: { glade_browser_input_control: 1, browserInputControlVerified: true },
      browserInputControlVerified: true,
      task,
    });
    expect(reply).toMatchObject({
      hostPlatform: "linux",
      driverBrowserInputControl: false,
      result: { structuredContent: { code: "linux_browser_cleanup_unavailable" } },
    });
    expect(
      (await f.events()).some((event) => event.event.startsWith("browser:browser_navigate:")),
    ).toBe(false);
  });

  it("requires the embedded metadata PID to match the child before trusting its marker", async () => {
    const f = await linuxFixture({ metadataPidOffset: 1 });
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      args: {},
      task,
    });
    expect(reply).toMatchObject({
      ok: false,
      effect: "not-dispatched",
      driverBrowserInputControl: false,
    });
    expect(reply.error).toContain("handshake failed");
    expect(
      (await f.events()).some((event) => event.event.startsWith("browser:browser_navigate:")),
    ).toBe(false);
  });

  it("does not spawn or expose the browser marker to an unauthenticated caller", async () => {
    const f = await linuxFixture();
    const reply = await rawCuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      args: {},
      task,
      capability: "not-authorized",
    });
    expect(reply).toMatchObject({
      ok: false,
      effect: "not-dispatched",
      driverBrowserInputControl: false,
    });
    expect(reply.error).toContain("authority");
    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports the Linux Escape diagnosis when listener activation itself fences input", async () => {
    let state: ComputerInputMonitorState = { ready: false, error: "input_monitor_idle" };
    let host: CuaDriverHost;
    const f = await linuxFixture({
      inputMonitorState: () => state,
      activateInputMonitor: async () => {
        state = { ready: false, error: "linux_escape_portal_unverified" };
        host.inputMonitorStateChanged(state);
      },
    });
    host = f.host;

    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_browser_state",
      args: {},
      task,
    });
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_prepare",
      args: { allow_launch: true, windowed: false },
      task,
    });
    expect(reply).toMatchObject({
      ok: true,
      result: {
        isError: true,
        structuredContent: {
          effect: "refused",
          code: "input_monitor_unavailable",
          input_monitor_error: "linux_escape_portal_unverified",
        },
      },
    });
    await waitForEvent(f, "interrupt-ack");
    expect(
      (await f.events()).some((event) => event.event.startsWith("browser:browser_prepare:")),
    ).toBe(false);
  });

  it("refuses Linux browser dispatch if its Escape listener is lost during session setup", async () => {
    let checks = 0;
    const f = await linuxFixture({
      inputMonitorState: () =>
        ++checks === 1 ? { ready: true } : { ready: false, error: "linux_escape_shortcut_lost" },
    });
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      args: {},
      task,
    });
    expect(reply.result?.structuredContent).toMatchObject({
      code: "input_monitor_unavailable",
      input_monitor_error: "linux_escape_shortcut_lost",
    });
    expect(
      (await f.events()).some((event) => event.event.startsWith("browser:browser_navigate:")),
    ).toBe(false);
  });
});
