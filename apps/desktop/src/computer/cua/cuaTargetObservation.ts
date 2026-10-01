import {
  CUA_ACTION_TOOLS,
  CUA_BROWSER_MUTATION_TOOLS,
  cuaComputerTaskKey,
  type CuaComputerTask,
  type CuaPreviewTarget,
  type CuaReply,
  type CuaToolResult,
} from "@glade/shared/computer/cuaDriverProtocol";
import { type Socket } from "node:net";
import { ControlledTarget, launchAppMatchNames, log, safeNativeId } from "./cuaHostPolicy";
import { type CuaHostRuntime } from "./cuaHostRuntimeTypes";
import { linuxBrowserCallIsReadOnly } from "./linuxCuaAdmission";

export function createCuaTargetObservation(
  hostRuntime: Pick<
    CuaHostRuntime,
    | "options"
    | "browserRecoveryObservations"
    | "browserTargets"
    | "controlledTargets"
    | "call"
    | "epoch"
    | "isFrameTaskEnded"
    | "userStoppedTasks"
    | "admissionState"
  >,
) {
  function taskStoppedReply(): CuaReply {
    return {
      ok: false,
      error: "The user stopped computer use for this turn. Do not retry actions.",
      effect: "not-dispatched",
    };
  }

  function rememberTask(set: Set<string>, task: CuaComputerTask): void {
    set.add(cuaComputerTaskKey(task));
    while (set.size > 256) set.delete(set.values().next().value!);
  }

  function inputMonitorAvailable(name: string, input: unknown): boolean {
    const linuxBrowserMutation =
      process.platform === "linux" &&
      CUA_BROWSER_MUTATION_TOOLS.has(name) &&
      !linuxBrowserCallIsReadOnly(name, input);
    const required =
      CUA_ACTION_TOOLS.has(name) ||
      linuxBrowserMutation ||
      (process.platform === "darwin" &&
        hostRuntime.options.nativeRevision !== null &&
        CUA_BROWSER_MUTATION_TOOLS.has(name));
    if (!required) return true;
    const monitor = hostRuntime.options.inputMonitorState?.();

    return monitor?.ready ?? !linuxBrowserMutation;
  }

  function isIsolatedBrowserSetup(name: string, input: unknown): boolean {
    if (name !== "browser_prepare" || !input || typeof input !== "object" || Array.isArray(input))
      return false;
    const args = input as Record<string, unknown>;
    const profile = args.profile;
    return (
      args.allow_launch === true &&
      args.pid === undefined &&
      args.window_id === undefined &&
      args.target_id === undefined &&
      args.strategy === undefined &&
      profile !== null &&
      typeof profile === "object" &&
      !Array.isArray(profile) &&
      ((profile as Record<string, unknown>).mode === "isolated_new" ||
        (profile as Record<string, unknown>).mode === "isolated_named")
    );
  }

  function browserRecoveryKey(
    input: unknown,
    task: CuaComputerTask | undefined,
  ): string | undefined {
    if (!task || !input || typeof input !== "object" || Array.isArray(input)) return undefined;
    const args = input as Record<string, unknown>;
    if (
      typeof args.target_id !== "string" ||
      args.target_id.length === 0 ||
      typeof args.tab_id !== "string" ||
      args.tab_id.length === 0
    )
      return undefined;
    return JSON.stringify([cuaComputerTaskKey(task), args.target_id, args.tab_id]);
  }

  function hasBrowserRecoveryObservation(
    input: unknown,
    task: CuaComputerTask | undefined,
  ): boolean {
    const key = browserRecoveryKey(input, task);
    return (
      key !== undefined &&
      hostRuntime.browserRecoveryObservations.get(key) === hostRuntime.admissionState().epoch
    );
  }

  function controlledTarget(
    input: unknown,
    task: CuaComputerTask | undefined,
    browser: boolean,
  ): ControlledTarget | undefined {
    if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
    const args = input as Record<string, unknown>;
    if (browser && task && typeof args.target_id === "string") {
      const bound = hostRuntime.browserTargets.get(JSON.stringify([task.threadId, args.target_id]));
      if (bound)
        return {
          ...bound,
          ...(typeof args.tab_id === "string" ? { browserTabId: args.tab_id } : {}),
        };
    }
    if (
      typeof args.pid !== "number" ||
      !Number.isSafeInteger(args.pid) ||
      args.pid <= 0 ||
      args.pid > 0x7fffffff
    )
      return undefined;
    return {
      pid: args.pid,
      ...(task ? { threadId: task.threadId } : {}),
      ...(typeof args.window_id === "number" &&
      Number.isSafeInteger(args.window_id) &&
      args.window_id > 0 &&
      args.window_id <= 0xffffffff
        ? { windowId: args.window_id }
        : {}),
    };
  }

  function rememberBrowserTarget(
    input: unknown,
    result: CuaToolResult | undefined,
    task: CuaComputerTask,
  ): void {
    const data = result?.structuredContent;
    if (data?.status !== "ok" || data.mode !== "bind" || typeof data.target_id !== "string") return;
    const target = controlledTarget(input, task, false);
    if (!target) return;
    const bound = { ...target, browserTargetId: data.target_id };
    hostRuntime.browserTargets.set(JSON.stringify([task.threadId, data.target_id]), bound);
    while (hostRuntime.browserTargets.size > 256)
      hostRuntime.browserTargets.delete(hostRuntime.browserTargets.keys().next().value!);
    hostRuntime.controlledTargets.set(cuaComputerTaskKey(task), bound);
  }

  function isBrowserSnapshot(input: unknown, result: CuaToolResult): boolean {
    if (!input || typeof input !== "object" || Array.isArray(input)) return false;
    const args = input as Record<string, unknown>;
    const data = result.structuredContent;
    const snapshot = data?.snapshot;
    const snapshotId =
      data?.snapshot_id ??
      (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
        ? (snapshot as Record<string, unknown>).id
        : undefined);
    return (
      data?.status === "ok" &&
      data.mode === "snapshot" &&
      typeof args.target_id === "string" &&
      args.target_id.length > 0 &&
      typeof args.tab_id === "string" &&
      args.tab_id.length > 0 &&
      data.target_id === args.target_id &&
      data.tab_id === args.tab_id &&
      typeof snapshotId === "string" &&
      /^p[0-9]+$/.test(snapshotId) &&
      Array.isArray(data.refs)
    );
  }

  function observationMatchesTarget(
    name: string,
    input: unknown,
    target: ControlledTarget,
    result: CuaToolResult,
  ): boolean {
    if (!input || typeof input !== "object" || Array.isArray(input)) return false;
    const args = input as Record<string, unknown>;
    if (target.browserTargetId !== undefined) {
      if (name !== "get_browser_state") return false;
      return (
        args.target_id === target.browserTargetId &&
        (target.browserTabId === undefined || args.tab_id === target.browserTabId)
      );
    }

    const state = result.structuredContent;
    const exactWindow = args.window_id === target.windowId;
    return (
      name === "get_window_state" &&
      args.pid === target.pid &&
      state?.pid === target.pid &&
      safeNativeId(args.window_id) !== undefined &&
      state.window_id === args.window_id &&
      !state.degraded &&
      state.screenshot_frame_valid !== false &&
      (target.windowId === undefined ||
        exactWindow ||
        (state.window_is_on_screen === true &&
          state.window_on_current_space === true &&
          Array.isArray(state.elements) &&
          state.elements.length > 0))
    );
  }

  function frameTapTarget(task: CuaComputerTask, input: unknown): CuaPreviewTarget | undefined {
    if (!input || typeof input !== "object") return undefined;
    const args = input as Record<string, unknown>;
    if (
      typeof args.pid !== "number" ||
      !Number.isSafeInteger(args.pid) ||
      args.pid <= 0 ||
      args.pid > 0x7fffffff ||
      typeof args.window_id !== "number" ||
      !Number.isSafeInteger(args.window_id) ||
      args.window_id <= 0 ||
      args.window_id > 0xffffffff
    )
      return undefined;
    return { task, pid: args.pid, windowId: args.window_id };
  }

  async function primeTapAfterLaunch(
    task: CuaComputerTask,
    input: unknown,
    connection: Socket,
    epoch: number,
  ): Promise<void> {
    const candidates = launchAppMatchNames(input);
    if (candidates.length === 0 || !hostRuntime.options.frameTap) return;
    const reply = await hostRuntime.call("list_windows", {}, connection, false);
    if (
      epoch !== hostRuntime.epoch ||
      hostRuntime.isFrameTaskEnded(task) ||
      hostRuntime.userStoppedTasks.has(cuaComputerTaskKey(task)) ||
      !reply.ok ||
      reply.result?.isError
    )
      return;
    const windows = (reply.result?.structuredContent as { windows?: unknown } | undefined)?.windows;
    if (!Array.isArray(windows)) return;
    let best: { pid: number; windowId: number; area: number } | undefined;
    for (const row of windows) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      const pid = record.pid;
      const windowId = record.window_id;
      const bounds = record.bounds as { width?: unknown; height?: unknown } | undefined;
      const width = typeof bounds?.width === "number" ? bounds.width : 0;
      const height = typeof bounds?.height === "number" ? bounds.height : 0;
      if (
        typeof pid !== "number" ||
        !Number.isSafeInteger(pid) ||
        pid <= 0 ||
        typeof windowId !== "number" ||
        !Number.isSafeInteger(windowId) ||
        windowId <= 0 ||
        record.is_on_screen !== true ||
        width <= 0 ||
        height <= 0
      )
        continue;
      const appName = typeof record.app_name === "string" ? record.app_name.toLowerCase() : "";
      if (!candidates.some((candidate) => appName === candidate || appName.includes(candidate)))
        continue;
      const area = width * height;
      if (!best || area > best.area) best = { pid, windowId, area };
    }
    if (!best) {
      log("computer frame tap launch prime: no on-screen window matched the launched app");
      return;
    }
    if (
      epoch !== hostRuntime.epoch ||
      hostRuntime.isFrameTaskEnded(task) ||
      hostRuntime.userStoppedTasks.has(cuaComputerTaskKey(task))
    )
      return;
    log(`computer frame tap launch prime: streaming pid ${best.pid} window ${best.windowId}`);
    hostRuntime.options.frameTap.update({
      task,
      pid: best.pid,
      windowId: best.windowId,
    });
  }

  return {
    taskStoppedReply,
    rememberTask,
    inputMonitorAvailable,
    isIsolatedBrowserSetup,
    browserRecoveryKey,
    hasBrowserRecoveryObservation,
    controlledTarget,
    rememberBrowserTarget,
    isBrowserSnapshot,
    observationMatchesTarget,
    frameTapTarget,
    primeTapAfterLaunch,
  };
}
