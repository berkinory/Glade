import { Schema, Effect, Stream, ServiceMap } from "effect";
import { ResolvedKeybindingsConfig, KeybindingRule } from "@glade/contracts/settings/keybindings";
import { type ServerConfigIssue } from "@glade/contracts/server/server";

export class KeybindingsConfigError extends Schema.TaggedErrorClass<KeybindingsConfigError>()(
  "KeybindingsConfigParseError",
  {
    configPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Unable to parse keybindings config at ${this.configPath}: ${this.detail}`;
  }
}

export interface KeybindingsConfigState {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly issues: readonly ServerConfigIssue[];
}

export interface KeybindingsChangeEvent {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly issues: readonly ServerConfigIssue[];
}

export interface KeybindingsShape {
  readonly start: Effect.Effect<void, KeybindingsConfigError>;

  readonly ready: Effect.Effect<void, KeybindingsConfigError>;

  readonly syncDefaultKeybindingsOnStartup: Effect.Effect<void, KeybindingsConfigError>;

  readonly loadConfigState: Effect.Effect<KeybindingsConfigState, KeybindingsConfigError>;

  readonly getSnapshot: Effect.Effect<KeybindingsConfigState, KeybindingsConfigError>;

  readonly streamChanges: Stream.Stream<KeybindingsChangeEvent>;

  // Replacing a semantic rule must preserve sibling conditions for the same command.
  readonly upsertKeybindingRule: (
    rule: KeybindingRule,
    replacing?: KeybindingRule,
  ) => Effect.Effect<ResolvedKeybindingsConfig, KeybindingsConfigError>;
}

export class Keybindings extends ServiceMap.Service<Keybindings, KeybindingsShape>()(
  "glade/keybindings",
) {}
