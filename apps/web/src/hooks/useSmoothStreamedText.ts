import { useCallback } from "react";

import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

const DRAIN_WINDOW_SECONDS = 0.16;

const MAX_CHARS_PER_SECOND = 2000;

const VELOCITY_LERP = 0.15;

const MAX_FRAME_SECONDS = 0.05;

const MIN_EMIT_INTERVAL_MS = 40;

interface SmoothRevealState {
  shown: number;

  velocity: number;

  lastFrameAt: number;

  lastEmitAt: number;
}

function createSmoothRevealState(shown: number): SmoothRevealState {
  return { shown, velocity: 0, lastFrameAt: 0, lastEmitAt: 0 };
}

interface SmoothRevealStep {
  emitCount: number | null;

  done: boolean;
}

function stepSmoothReveal(
  state: SmoothRevealState,
  nowMs: number,
  targetLength: number,
  emittedCount: number,
): SmoothRevealStep {
  const previousFrameAt = state.lastFrameAt;
  const dt = previousFrameAt ? Math.min((nowMs - previousFrameAt) / 1000, MAX_FRAME_SECONDS) : 0;
  state.lastFrameAt = nowMs;

  if (state.shown > targetLength) state.shown = targetLength;

  const backlog = targetLength - state.shown;
  if (backlog <= 0) {
    state.velocity = 0;
    state.lastFrameAt = 0;
    return { emitCount: null, done: true };
  }

  const targetVelocity = Math.min(MAX_CHARS_PER_SECOND, backlog / DRAIN_WINDOW_SECONDS);
  state.velocity += (targetVelocity - state.velocity) * VELOCITY_LERP;
  state.shown = Math.min(targetLength, state.shown + state.velocity * dt);

  if (targetLength - state.shown < 0.001) {
    state.shown = targetLength;
  }

  const nextCount = Math.floor(state.shown);
  const caughtUp = nextCount >= targetLength;
  const emitDue =
    nextCount !== emittedCount &&
    (caughtUp || state.lastEmitAt === 0 || nowMs - state.lastEmitAt >= MIN_EMIT_INTERVAL_MS);
  if (emitDue) {
    state.lastEmitAt = nowMs;
  }

  const done = targetLength - state.shown <= 0;
  if (done) {
    state.velocity = 0;
    state.lastFrameAt = 0;
  }
  return { emitCount: emitDue ? nextCount : null, done };
}

export function useSmoothStreamedText(text: string, isStreaming: boolean): string {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // Testable env (jsdom/vitest) has no rAF or has mocked timers – smooth reveal would jank and never
  // settle. Fall back to immediate text so streaming tests stay deterministic and the main thread
  // isn't blocked by rAF loops.
  const isTestableEnv =
    typeof window === "undefined" ||
    typeof (window as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame !==
      "function" ||
    (typeof process !== "undefined" &&
      (process.env.VITEST === "true" || process.env.NODE_ENV === "test"));
  const animate = isStreaming && !reduceMotion && !isTestableEnv;

  const [revealed, setRevealed] = useState(text);

  const targetRef = useRef(text);
  const stateRef = useRef<SmoothRevealState>(createSmoothRevealState(text.length));

  const emittedRef = useRef(text.length);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<(now: number) => void>(() => undefined);

  const cancelFrame = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const scheduleFrame = useCallback(() => {
    if (rafRef.current != null) {
      return;
    }
    rafRef.current = requestAnimationFrame((now) => {
      rafRef.current = null;
      tickRef.current(now);
    });
  }, []);

  useEffect(() => {
    tickRef.current = (now: number) => {
      const target = targetRef.current;
      const step = stepSmoothReveal(stateRef.current, now, target.length, emittedRef.current);
      if (step.emitCount !== null) {
        emittedRef.current = step.emitCount;
        setRevealed(step.emitCount >= target.length ? target : target.slice(0, step.emitCount));
      }
      if (!step.done) {
        scheduleFrame();
      }
    };
  }, [scheduleFrame]);

  useEffect(() => {
    const previousTarget = targetRef.current;
    const isAppendOnly = text.length >= previousTarget.length && text.startsWith(previousTarget);
    targetRef.current = text;

    if (!animate || !isAppendOnly) {
      cancelFrame();
      stateRef.current = createSmoothRevealState(text.length);
      emittedRef.current = text.length;
      setRevealed(text);
      return;
    }

    if (text.length > stateRef.current.shown) {
      scheduleFrame();
    }
  }, [animate, cancelFrame, scheduleFrame, text]);

  useEffect(() => () => cancelFrame(), [cancelFrame]);

  return animate ? revealed : text;
}
