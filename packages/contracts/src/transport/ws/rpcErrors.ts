import { Schema } from "effect";

export class WsRpcError extends Schema.TaggedErrorClass<WsRpcError>()("WsRpcError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
  code: Schema.optional(Schema.String),
  retryable: Schema.optional(Schema.Boolean),
  retryAfterMs: Schema.optional(Schema.Number),
}) {}

// A subscriber fell behind its bounded live-event budget. Only that subscription restarts, resuming
// from the client's last applied cursor or a fresh snapshot.
export const WS_STREAM_OVERFLOW_CODE = "WS_STREAM_OVERFLOW";
