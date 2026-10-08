import { Schema } from "effect";

// Host state of the keep-awake assertion. The preference itself lives in server settings.
export const ServerKeepAwakeStatus = Schema.Struct({
  supported: Schema.Boolean,
  active: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
});
export type ServerKeepAwakeStatus = typeof ServerKeepAwakeStatus.Type;
