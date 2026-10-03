import { Schema } from "effect";

const AuthenticationProvider = Schema.Literals(["claudeAgent", "codex"]);
export const ProviderAuthenticationRequest = Schema.Struct({
  provider: AuthenticationProvider,
  action: Schema.Literals(["status", "start", "write", "resize", "close"]),
  id: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
  data: Schema.optional(Schema.String.check(Schema.isMaxLength(8192))),
  cols: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: 300 }))),
  rows: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 100 }))),
});
export type ProviderAuthenticationRequest = typeof ProviderAuthenticationRequest.Type;
export const ProviderAuthenticationStatus = Schema.Struct({
  id: Schema.String,
  provider: AuthenticationProvider,
  status: Schema.Literals(["running", "exited"]),
  output: Schema.String,
  outputOffset: Schema.Number,
  exitCode: Schema.NullOr(Schema.Number),
  executable: Schema.String,
  home: Schema.String,
});
export type ProviderAuthenticationStatus = typeof ProviderAuthenticationStatus.Type;
export const PROVIDER_AUTHENTICATION_PATH = "/api/provider-authentication";
