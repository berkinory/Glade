import { Schema } from "effect";

import { EnvironmentId, TrimmedNonEmptyString } from "../core/baseSchemas";
import { ServerAuthDescriptor } from "../transport/auth/auth";

export const ExecutionEnvironmentPlatformOs = Schema.Literals([
  "darwin",
  "linux",
  "windows",
  "unknown",
]);
export type ExecutionEnvironmentPlatformOs = typeof ExecutionEnvironmentPlatformOs.Type;

export const ExecutionEnvironmentPlatformArch = Schema.Literals(["arm64", "x64", "other"]);
export type ExecutionEnvironmentPlatformArch = typeof ExecutionEnvironmentPlatformArch.Type;

export const ExecutionEnvironmentPlatform = Schema.Struct({
  os: ExecutionEnvironmentPlatformOs,
  arch: ExecutionEnvironmentPlatformArch,
});
export type ExecutionEnvironmentPlatform = typeof ExecutionEnvironmentPlatform.Type;

export const ExecutionEnvironmentCapabilities = Schema.Struct({
  repositoryIdentity: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
});
export type ExecutionEnvironmentCapabilities = typeof ExecutionEnvironmentCapabilities.Type;

export const ExecutionEnvironmentDescriptor = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
  platform: ExecutionEnvironmentPlatform,
  serverVersion: TrimmedNonEmptyString,
  capabilities: ExecutionEnvironmentCapabilities,
});
export type ExecutionEnvironmentDescriptor = typeof ExecutionEnvironmentDescriptor.Type;

export const ENVIRONMENT_DESCRIPTOR_PATH = "/.well-known/glade/environment";

// Served without authentication. A client checks it on a route before sending any credential, so
// an address that now reaches another machine never receives one.
export const PublicEnvironmentDescriptor = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
  platform: ExecutionEnvironmentPlatform,
  serverVersion: TrimmedNonEmptyString,
  protocol: Schema.Struct({
    epoch: Schema.Number,
    minRevision: Schema.Number,
    maxRevision: Schema.Number,
  }),
  auth: ServerAuthDescriptor,
});
export type PublicEnvironmentDescriptor = typeof PublicEnvironmentDescriptor.Type;
