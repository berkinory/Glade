import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { ProviderKind } from "../../core/baseSchemas";
import { WsRpcError } from "./rpcErrors";

export const SKILLS_DIRECTORY_WS_METHODS = {
  search: "skillsDirectory.search",
  preview: "skillsDirectory.preview",
  install: "skillsDirectory.install",
} as const;

// A skill listed on skills.sh, found in a GitHub repository.
export const SkillsDirectoryEntry = Schema.Struct({
  repository: Schema.String,
  skillId: Schema.String,
  name: Schema.String,
  installs: Schema.Number,
});
export type SkillsDirectoryEntry = typeof SkillsDirectoryEntry.Type;

export const SkillsDirectorySearchResult = Schema.Struct({
  skills: Schema.Array(SkillsDirectoryEntry),
});
export type SkillsDirectorySearchResult = typeof SkillsDirectorySearchResult.Type;

// A security review skills.sh publishes for the skill.
export const SkillAudit = Schema.Struct({
  provider: Schema.String,
  status: Schema.String,
  summary: Schema.String,
});
export type SkillAudit = typeof SkillAudit.Type;

// A skill folder at one commit, as Glade would install it.
export const SkillPreview = Schema.Struct({
  repository: Schema.String,
  commit: Schema.String,
  path: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  instructions: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String, size: Schema.Number })),
  // Set when the folder ships executable files or scripts an agent could run.
  hasScripts: Schema.Boolean,
  // Null when skills.sh could not be asked; empty when it has reviewed nothing.
  audits: Schema.NullOr(Schema.Array(SkillAudit)),
});
export type SkillPreview = typeof SkillPreview.Type;

export const SkillInstallInput = Schema.Struct({
  repository: Schema.String,
  commit: Schema.String,
  path: Schema.String,
  // Null installs into the shared folder every agent reads, including ones added later.
  providers: Schema.NullOr(Schema.Array(ProviderKind)),
});
export type SkillInstallInput = typeof SkillInstallInput.Type;

export const WsSkillsDirectorySearchRpc = Rpc.make(SKILLS_DIRECTORY_WS_METHODS.search, {
  payload: Schema.Struct({ query: Schema.String }),
  success: SkillsDirectorySearchResult,
  error: WsRpcError,
});

// `reference` is a skills.sh id or URL, or a GitHub repository or folder URL.
export const WsSkillsDirectoryPreviewRpc = Rpc.make(SKILLS_DIRECTORY_WS_METHODS.preview, {
  payload: Schema.Struct({ reference: Schema.String }),
  success: SkillPreview,
  error: WsRpcError,
});

export const WsSkillsDirectoryInstallRpc = Rpc.make(SKILLS_DIRECTORY_WS_METHODS.install, {
  payload: SkillInstallInput,
  success: Schema.Struct({ installedPaths: Schema.Array(Schema.String) }),
  error: WsRpcError,
});
