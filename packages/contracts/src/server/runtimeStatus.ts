import { Schema } from "effect";
import { NonNegativeInt } from "../core/baseSchemas";

const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

// Aggregate event-loop counters only: no paths, stacks or identifiers.
export const ServerRuntimeStatus = Schema.Struct({
  available: Schema.Boolean,
  delayP99Ms: Milliseconds,
  delayMaxMs: Milliseconds,
  utilization: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  stallCount: NonNegativeInt,
  idleGapCount: NonNegativeInt,
  lastStall: Schema.NullOr(Schema.Struct({ durationMs: Milliseconds, ageMs: Milliseconds })),
});
export type ServerRuntimeStatus = typeof ServerRuntimeStatus.Type;
