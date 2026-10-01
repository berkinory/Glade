import { Schema } from "effect";
import { IsoDateTime, TrimmedString } from "../core/baseSchemas";
import { ModelSelection } from "../provider/sessionPolicy";
import { ThreadEnvironmentMode } from "../orchestration/threadEntities";
import { ProviderKind } from "../core/baseSchemas";

const StringSetting = TrimmedString.check(Schema.isMaxLength(4096));

const ProviderSettingsBase = {
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
};

export const CodexServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "codex")),
  homePath: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type CodexServerProviderSettings = typeof CodexServerProviderSettings.Type;

export const ClaudeServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "claude")),
  launchArgs: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withDecodingDefault(() => ""),
  ),

  enableArtifacts: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
});
export type ClaudeServerProviderSettings = typeof ClaudeServerProviderSettings.Type;

const DisabledSkillNames = Schema.Array(Schema.String.check(Schema.isMaxLength(256))).pipe(
  Schema.withDecodingDefault(() => []),
);

// User-level skill toggles. Skills are keyed by lowercased name because the unified catalog dedupes
// provider copies of the same skill by name.
export const SkillsServerSettings = Schema.Struct({
  disabled: DisabledSkillNames,
});
export type SkillsServerSettings = typeof SkillsServerSettings.Type;

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  enableProviderUpdateChecks: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  defaultThreadEnvMode: ThreadEnvironmentMode.pipe(Schema.withDecodingDefault(() => "local")),
  addProjectBaseDirectory: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  textGenerationModelSelection: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  providers: Schema.Struct({
    codex: CodexServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    claudeAgent: ClaudeServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  }).pipe(Schema.withDecodingDefault(() => ({}))),
  skills: SkillsServerSettings.pipe(Schema.withDecodingDefault(() => ({}))),

  onboardingCompletedAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

export const ServerSettingsView = ServerSettings;
export type ServerSettingsView = typeof ServerSettingsView.Type;

export const DEFAULT_SERVER_SETTINGS_VIEW: ServerSettingsView = Schema.decodeSync(
  ServerSettingsView,
)({});

const ModelSelectionPatch = Schema.Struct({
  provider: Schema.optionalKey(ProviderKind),
  model: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))),
  options: Schema.optionalKey(Schema.Unknown),
});

const ProviderSettingsBasePatch = {
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(StringSetting),
};

export const ServerSettingsPatch = Schema.Struct({
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  enableProviderUpdateChecks: Schema.optionalKey(Schema.Boolean),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvironmentMode),
  addProjectBaseDirectory: Schema.optionalKey(StringSetting),
  textGenerationModelSelection: Schema.optionalKey(Schema.NullOr(ModelSelectionPatch)),
  providers: Schema.optionalKey(
    Schema.Struct({
      codex: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          homePath: Schema.optionalKey(StringSetting),
        }),
      ),
      claudeAgent: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          launchArgs: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4096))),
          enableArtifacts: Schema.optionalKey(Schema.Boolean),
        }),
      ),
    }),
  ),
  skills: Schema.optionalKey(
    Schema.Struct({
      disabled: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMaxLength(256)))),
    }),
  ),
  onboardingCompletedAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    settingsPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Server settings error at ${this.settingsPath}: ${this.detail}`;
  }
}
