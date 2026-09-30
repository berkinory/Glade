import { type CuaReply } from "@glade/shared/computer/cuaDriverProtocol";
import { describe, expect, it } from "vitest";
import { capability, cuaRequest, fixture, waitForEvent } from "./cuaHostFixture";
describe("task-owned user stop", () => {
  const task = { threadId: "thread", turnId: "turn" };
  it("user Stop refuses subsequent calls from the same turn", async () => {
    const f = await fixture();
    await f.host.stopTaskByUser(task);
    const blocked = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "press_key",
      task,
      args: { key: "enter", pid: 42, window_id: 10 },
    });
    expect(blocked).toMatchObject({ ok: false, effect: "not-dispatched" });
    expect(blocked.error).toContain("user stopped");
    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });
    const next = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "get_window_state",
      task: { ...task, turnId: "next" },
      modelObservation: true,
      args: { pid: 42, window_id: 10 },
    });
    expect(next.ok).toBe(true);
  });

  it("drains matching native input and reports that queued siblings share the generation fence", async () => {
    const f = await fixture();
    const active = cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "type_text",
      task,
      args: { text: "fixture" },
    });
    await waitForEvent(f, "dispatch");
    const sibling = { threadId: "other-thread", turnId: "turn" };
    const queued = cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "press_key",
      task: sibling,
      args: { key: "enter" },
    });
    await expect(cuaRequest(f.endpoint, { method: "stop", task })).resolves.toMatchObject({
      ok: true,
      result: { stop_scope: "generation" },
    });
    await expect(active).resolves.toMatchObject({ ok: false, effect: "dispatched-unknown" });
    await expect(queued).resolves.toMatchObject({ ok: false, effect: "not-dispatched" });
    await expect(
      cuaRequest(f.endpoint, {
        method: "call",
        name: "press_key",
        task: sibling,
        args: { key: "enter" },
      }),
    ).resolves.toMatchObject({ ok: true });
    const events = (await f.events()).map((row) => row.event);
    expect(events.indexOf("interrupt-ack")).toBeLessThan(events.indexOf("key"));
    expect(events.filter((event) => event === "start")).toHaveLength(1);
    expect(events).not.toContain("effect");
    expect(events).not.toContain("cancel");
    expect(events).not.toContain("retiring");
  });

  it("revokes a task during native startup without retiring the sibling's shared generation", async () => {
    const f = await fixture(capability, { metadataDelayMs: 100 });
    const starting = cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "press_key",
      task,
      args: { key: "enter" },
    });
    await waitForEvent(f, "start");
    await expect(cuaRequest(f.endpoint, { method: "stop", task })).resolves.toMatchObject({
      ok: true,
      result: { stop_scope: "task" },
    });
    await expect(starting).resolves.toMatchObject({ ok: false, effect: "not-dispatched" });
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "press_key", args: { key: "enter" } }),
    ).resolves.toMatchObject({ ok: true });
    const events = (await f.events()).map((row) => row.event);
    expect(events.filter((event) => event === "key")).toHaveLength(1);
    expect(events.filter((event) => event === "start")).toHaveLength(1);
    expect(events).not.toContain("interrupt");
    expect(events).not.toContain("retiring");
  });
});

describe("browser surface", () => {
  const task = { threadId: "thread", turnId: "turn" };
  it("attributes browser calls to a per-thread lifecycle session under the control transport", async () => {
    const f = await fixture();
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      task,
      args: { url: "https://example.com" },
    });
    expect(reply.ok).toBe(true);
    const events = (await f.events()).map((row) => row.event);

    expect(events.some((event) => event.startsWith("session-begin:glade-transport-"))).toBe(true);
    expect(
      events.some((event) =>
        event.startsWith("browser:browser_navigate:glade-browser-thread:glade-transport-"),
      ),
    ).toBe(true);

    const forged = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_click",
      task,
      args: { target_id: "t", tab_id: "tab", ref: "p1:0", session: "forged" },
    });
    expect(forged.ok).toBe(true);
    expect(
      (await f.events()).some((row) =>
        String(row.event).startsWith("browser:browser_click:forged"),
      ),
    ).toBe(false);
    expect(
      (await f.events()).some((row) =>
        String(row.event).startsWith("browser:browser_click:glade-browser-thread:glade-transport-"),
      ),
    ).toBe(true);
  });
  it("refuses browser calls without task attribution before starting a daemon", async () => {
    const f = await fixture();
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      args: { url: "https://example.com" },
    });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain("task attribution");
    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses a browser bind that names one of this app's own pids", async () => {
    const f = await fixture(capability, { ownPids: () => new Set([424242]) });
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "get_browser_state",
      task,
      args: { pid: 424242, window_id: 20 },
    });
    expect(reply.ok).toBe(true);
    expect(reply.result?.isError).toBe(true);
    expect(reply.result?.structuredContent).toMatchObject({
      effect: "refused",
      code: "browser_self_target",
    });

    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });

    const other = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "get_browser_state",
      task,
      args: { pid: 777, window_id: 20 },
    });
    expect(other.ok).toBe(true);
    expect(
      (await f.events()).some((row) => String(row.event).startsWith("browser:get_browser_state:")),
    ).toBe(true);
  });
});
