import {
  cuaComputerTaskKey,
  cuaRequest,
  type CuaComputerTask,
  type CuaReply,
} from "@glade/shared/computer/cuaDriverProtocol";
import { CuaCursorStyle, Generation, log, normalizeCuaCursorStyle } from "./cuaHostPolicy";
import { type CuaHostRuntime } from "./cuaHostRuntimeTypes";

export function createCuaTaskCursors(
  hostRuntime: Pick<
    CuaHostRuntime,
    | "observedNativeRevision"
    | "operations"
    | "generation"
    | "controlledTargets"
    | "takeoverTargets"
    | "monitoredTasks"
    | "inputMonitorRequested"
    | "inputMonitorArmed"
    | "options"
    | "rememberTask"
    | "endedFrameTasks"
    | "frameTapTask"
    | "closed"
    | "cursorStyleUpdates"
  >,
) {
  async function logCursorState(
    generation: Generation,
    label: string,
    task: CuaComputerTask,
    stage: "session-created" | "first-action",
  ): Promise<void> {
    if (hostRuntime.observedNativeRevision === 0) return;
    const fields: Record<string, unknown> = {
      event: "computer_cursor",
      ts: new Date().toISOString(),
      thread: task.threadId,
      turn: task.turnId,
      stage,
    };
    try {
      const reply = await cuaRequest<CuaReply>(
        generation.socket,
        {
          method: "call",
          name: "get_agent_cursor_state",
          args: { session: label },
        },
        { timeoutMs: 250 },
      );
      const state = reply.result?.structuredContent;
      const motion = state?.motion as Record<string, unknown> | undefined;
      fields.status = reply.ok && !reply.result?.isError ? "reported" : "unavailable";
      if (typeof state?.enabled === "boolean") fields.enabled = state.enabled;
      if (state && "position" in state) fields.has_position = state.position != null;
      if (typeof motion?.idle_hide_ms === "number" && Number.isFinite(motion.idle_hide_ms))
        fields.idle_hide_ms = motion.idle_hide_ms;
      if (typeof state?.overlay_ready === "boolean") fields.overlay_ready = state.overlay_ready;
      if (typeof state?.render_visible === "boolean") fields.render_visible = state.render_visible;
      if (state?.overlay_scope === "main_display") fields.overlay_scope = state.overlay_scope;
    } catch {
      fields.status = "query-failed";
    }
    log(JSON.stringify(fields));
  }

  async function endCursorSession(generation: Generation, label: string): Promise<boolean> {
    const cursor = generation.taskCursors.get(label);
    const hidden = await setTaskCursorEnabled(generation, label, false);

    if (hidden) generation.taskCursors.delete(label);
    else if (cursor) cursor.enabled = false;
    log(
      JSON.stringify({
        event: "computer_cursor",
        ts: new Date().toISOString(),
        thread: cursor?.task.threadId,
        turn: cursor?.task.turnId,
        stage: "task-end",
        status: hidden ? "hidden" : "hide-failed",
      }),
    );
    return hidden;
  }

  async function setTaskCursorEnabled(
    generation: Generation,
    label: string,
    enabled: boolean,
  ): Promise<boolean> {
    try {
      const reply = await cuaRequest<CuaReply>(
        generation.socket,
        {
          method: "call",
          name: "set_agent_cursor_enabled",
          args: { session: label, enabled },
        },
        { timeoutMs: 500 },
      );
      return reply.ok && !reply.result?.isError;
    } catch {
      return false;
    }
  }

  async function endTaskCursors(
    task: CuaComputerTask,
    allTurns = task.turnId === undefined,
  ): Promise<void> {
    const previous = hostRuntime.operations;
    const operation = (async () => {
      await previous;
      const generation = hostRuntime.generation;
      if (!generation || generation.retired || generation.didExit) return;
      for (const [label, cursor] of generation.taskCursors) {
        if (
          cursor.task.threadId === task.threadId &&
          (allTurns || cursor.task.turnId === task.turnId)
        )
          await endCursorSession(generation, label);
      }
    })();
    hostRuntime.operations = operation.catch(() => undefined);
    await operation;
  }

  async function endTask(
    task: CuaComputerTask,
    allTurns: boolean,
    waitForCursor = true,
  ): Promise<void> {
    const taskKey = cuaComputerTaskKey(task);
    hostRuntime.controlledTargets.delete(taskKey);
    hostRuntime.takeoverTargets.delete(taskKey);
    hostRuntime.monitoredTasks.delete(taskKey);
    if (allTurns) {
      for (const [key, target] of hostRuntime.controlledTargets) {
        if (target.threadId === task.threadId) hostRuntime.controlledTargets.delete(key);
      }
      for (const [key, target] of hostRuntime.takeoverTargets) {
        if (target.threadId === task.threadId) hostRuntime.takeoverTargets.delete(key);
      }
      for (const [key, threadId] of hostRuntime.monitoredTasks) {
        if (threadId === task.threadId) hostRuntime.monitoredTasks.delete(key);
      }
    }
    if (hostRuntime.monitoredTasks.size === 0) {
      hostRuntime.inputMonitorRequested = false;
      hostRuntime.inputMonitorArmed = false;
      hostRuntime.options.onInputMonitorArmedChange?.(false);
    }
    hostRuntime.rememberTask(hostRuntime.endedFrameTasks, task);
    if (
      hostRuntime.frameTapTask?.threadId === task.threadId &&
      (allTurns || task.turnId === hostRuntime.frameTapTask.turnId)
    ) {
      hostRuntime.rememberTask(hostRuntime.endedFrameTasks, hostRuntime.frameTapTask);
      hostRuntime.frameTapTask = undefined;
    }
    // Preview/shield authority ends immediately. Cosmetic cursor cleanup stays on the native queue, but
    // task Stop must not wait for another task's long-running native action merely to hide this task's
    // cursor.
    const cursorEnded = endTaskCursors(task, allTurns);
    if (!waitForCursor)
      void cursorEnded.catch((error: unknown) =>
        log(`stopped task cursor cleanup failed: ${String(error)}`),
      );
    await Promise.all([
      hostRuntime.options.frameTap?.endTask(task),
      hostRuntime.options.shield?.endTask(task),
      ...(waitForCursor ? [cursorEnded] : []),
    ]);
  }

  function setCursorStyle(style: CuaCursorStyle | null | undefined): Promise<void> {
    const next = normalizeCuaCursorStyle(style);
    const nextJson = next ? JSON.stringify(next) : "";
    const apply = async (): Promise<void> => {
      const generation = hostRuntime.generation;
      if (!generation || generation.retired || generation.didExit) return;
      // A generation without an opened session takes the preference at its next open; a settings change
      // must not warm or spawn a driver.
      if (!generation.sessionOpening) return;
      await generation.sessionOpening.catch(() => undefined);
      if (
        hostRuntime.closed ||
        generation.retired ||
        generation.didExit ||
        generation.appliedCursorStyle === nextJson ||
        hostRuntime.observedNativeRevision === 0
      )
        return;
      try {
        const reply = await cuaRequest<CuaReply>(
          generation.socket,
          {
            method: "call",
            name: "set_agent_cursor_style",
            args: next ? { session: generation.session, ...next } : { session: generation.session },
          },
          { timeoutMs: 5_000 },
        );
        if (!reply.ok || reply.result?.isError) {
          log("live cursor style push was refused; keeping the previous style");
          return;
        }
        generation.appliedCursorStyle = nextJson;
      } catch (error) {
        log(`live cursor style push failed: ${String(error)}`);
      }
    };
    hostRuntime.cursorStyleUpdates = hostRuntime.cursorStyleUpdates.then(apply, apply);
    return hostRuntime.cursorStyleUpdates;
  }

  async function applyCursorStyleForSession(
    generation: Generation,
    session: string,
  ): Promise<void> {
    const style = normalizeCuaCursorStyle(hostRuntime.options.cursorStyle?.());
    const previous = generation.appliedSessionCursorStyles.get(session);

    if (!style && previous === undefined) return;
    const styleJson = style ? JSON.stringify(style) : "";
    if (previous === styleJson) return;
    if (hostRuntime.observedNativeRevision === 0) return;
    try {
      const reply = await cuaRequest<CuaReply>(
        generation.socket,
        {
          method: "call",
          name: "set_agent_cursor_style",
          args: style ? { session, ...style } : { session },
        },
        { timeoutMs: 5_000 },
      );
      if (!reply.ok || reply.result?.isError) {
        log("task cursor style was refused; keeping the previous cursor");
        return;
      }
      if (style) generation.appliedSessionCursorStyles.set(session, styleJson);
      else generation.appliedSessionCursorStyles.delete(session);
      while (generation.appliedSessionCursorStyles.size > 256) {
        generation.appliedSessionCursorStyles.delete(
          generation.appliedSessionCursorStyles.keys().next().value!,
        );
      }
    } catch (error) {
      log(`task cursor style setup failed: ${String(error)}`);
    }
  }

  return {
    logCursorState,
    endCursorSession,
    setTaskCursorEnabled,
    endTask,
    setCursorStyle,
    applyCursorStyleForSession,
  };
}
