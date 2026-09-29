import { AsyncLocalStorage } from "node:async_hooks";

import type { ComputerBackendActionResult } from "./ComputerBackend.ts";

// Per-computer-call context for the action path, carried on AsyncLocalStorage so one tool call's
// dispatch, settle, and observation see the same record without the gateway handing anything
// through. Scoped to the call so a stale verdict can never waive a later call's wait. When neither
// consumer is enabled no context is created at all, so a call with both off still allocates
// nothing. The ones still gated default to the previous behavior so a live run can isolate a single
// optimization at a time; the graduated ones default on with an explicit-off kill switch.

function envFlagEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
}

function envFlagDisabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no"
  );
}

export function cuaTimingLogEnabled(): boolean {
  return envFlagEnabled(process.env.GLADE_CUA_TIMING_LOG);
}

export function cuaConditionalSettleEnabled(): boolean {
  return !envFlagDisabled(process.env.GLADE_CUA_CONDITIONAL_SETTLE);
}

export function cuaActionSettleMsOverride(): number | undefined {
  const raw = process.env.GLADE_CUA_ACTION_SETTLE_MS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function cuaCaptureReuseEnabled(): boolean {
  return !envFlagDisabled(process.env.GLADE_CUA_CAPTURE_REUSE);
}

export function cuaPreviewStillMsOverride(): number | undefined {
  const raw = process.env.GLADE_CUA_PREVIEW_STILL_MS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export interface ComputerActionProof {
  readonly effect: ComputerBackendActionResult["effect"];
  readonly verified: ComputerBackendActionResult["verified"];
}

export class ComputerCallTiming {
  private operation: string | undefined;
  private readonly startedAt: number;
  private readonly legs = new Map<string, number>();
  private readonly counts = new Map<string, number>();
  private failed = false;
  private finished = false;

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  setOperation(operation: string): void {
    this.operation ??= operation;
  }

  markFailed(): void {
    this.failed = true;
  }

  record(leg: string, ms: number): void {
    this.legs.set(leg, (this.legs.get(leg) ?? 0) + ms);
  }

  count(name: string, by = 1): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + by);
  }

  async span<A>(leg: string, run: () => Promise<A>): Promise<A> {
    const started = this.now();
    try {
      return await run();
    } finally {
      this.record(leg, this.now() - started);
    }
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    const parts = [`op=${this.operation ?? "computer_call"}`];
    for (const [leg, ms] of [...this.legs.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
      parts.push(`${leg}_ms=${ms.toFixed(1)}`);
    }
    for (const [name, count] of [...this.counts.entries()].toSorted(([a], [b]) =>
      a.localeCompare(b),
    )) {
      parts.push(`${name}=${count}`);
    }
    parts.push(`total_ms=${(this.now() - this.startedAt).toFixed(1)}`);
    if (this.failed) parts.push("failed=1");
    console.info(`[computer-timing] ${parts.join(" ")}`);
  }
}

export class ComputerCallContext {
  readonly timing: ComputerCallTiming | undefined;
  private proof: ComputerActionProof | undefined;

  constructor(options: { readonly timing?: ComputerCallTiming }) {
    this.timing = options.timing;
  }

  recordActionProof(result: ComputerBackendActionResult | void): void {
    this.proof = { effect: result?.effect, verified: result?.verified };
  }

  takeActionProof(): ComputerActionProof | undefined {
    const proof = this.proof;
    this.proof = undefined;
    return proof;
  }
}

const computerCalls = new AsyncLocalStorage<ComputerCallContext>();

export function currentComputerCall(): ComputerCallContext | undefined {
  return computerCalls.getStore();
}

export function withComputerCallContext<A>(
  context: ComputerCallContext,
  run: () => Promise<A>,
): Promise<A> {
  return computerCalls.run(context, run);
}

export function createComputerCallContext(): ComputerCallContext | undefined {
  const timing = cuaTimingLogEnabled() ? new ComputerCallTiming() : undefined;
  if (timing === undefined && !cuaConditionalSettleEnabled()) return undefined;
  return new ComputerCallContext(timing === undefined ? {} : { timing });
}

export async function timedComputerLeg<A>(leg: string, run: () => Promise<A>): Promise<A> {
  const timing = currentComputerCall()?.timing;
  return timing === undefined ? run() : timing.span(leg, run);
}

export function markComputerCall(operation: string): void {
  currentComputerCall()?.timing?.setOperation(operation);
}
