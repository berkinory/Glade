import { Schema } from "effect";

// Login shells may print banners on stdout, so the launcher's answer is one marked line.
export const REMOTE_SERVER_LAUNCH_MARKER = "GLADE_REMOTE_SERVER ";

export const RemoteServerLaunch = Schema.Struct({
  version: Schema.String,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  authToken: Schema.String.check(Schema.isMinLength(32)),
});
export type RemoteServerLaunch = typeof RemoteServerLaunch.Type;
