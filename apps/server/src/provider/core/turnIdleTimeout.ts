export function evaluateTurnIdleTick(input: {
  readonly isTurnActive: boolean;
  readonly isAwaitingHuman: boolean;
  readonly idleMs: number;
  readonly idleTimeoutMs: number;
}): "stop" | "touch" | "timeout" | "continue" {
  if (!input.isTurnActive) return "stop";
  if (input.isAwaitingHuman) return "touch";
  return input.idleMs >= input.idleTimeoutMs ? "timeout" : "continue";
}

export function resolveTurnIdleTimeoutMs(input: {
  readonly envVar: string;
  readonly defaultMs: number;
  readonly env?: NodeJS.ProcessEnv;
}): number {
  const raw = (input.env ?? process.env)[input.envVar]?.trim();
  if (!raw) return input.defaultMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : input.defaultMs;
}
