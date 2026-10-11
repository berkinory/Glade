import { Schema } from "effect";

export const GitHubConnectionStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal("connected"), login: Schema.String }),
  Schema.Struct({ state: Schema.Literal("not_installed") }),
  Schema.Struct({ state: Schema.Literal("signed_out") }),
  Schema.Struct({ state: Schema.Literal("error"), detail: Schema.String }),
]);
export type GitHubConnectionStatus = typeof GitHubConnectionStatus.Type;
