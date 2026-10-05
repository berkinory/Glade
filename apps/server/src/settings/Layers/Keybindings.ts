import {
  Effect,
  FileSystem,
  Path,
  PubSub,
  Ref,
  Deferred,
  Scope,
  Exit,
  Schema,
  Cause,
  Array,
  Predicate,
  Option,
  SchemaIssue,
  Cache,
  Stream,
  Layer,
} from "effect";
import { ServerConfig } from "../../server/config";
import * as Semaphore from "effect/Semaphore";
import {
  KeybindingRule,
  KeybindingCommand,
  MAX_KEYBINDINGS_COUNT,
} from "@glade/contracts/settings/keybindings";
import { type ServerConfigIssue } from "@glade/contracts/server/server";
import { writeFileStringAtomically } from "../../platform/filesystem/atomicWrite";
import {
  KeybindingsChangeEvent,
  KeybindingsConfigError,
  KeybindingsConfigState,
  KeybindingsShape,
  Keybindings,
} from "../Services/Keybindings";
import {
  decodeRawKeybindingsEntries,
  readKeybindingEntryCommand,
  isRetiredLegacyKeybindingCommand,
  normalizeLegacyKeybindingEntry,
  malformedConfigIssue,
  invalidEntryIssue,
  migrateOutdatedDefaultKeybindingRule,
  migrateOutdatedSidebarSearchDefault,
  relaxCreationCommandTerminalGuards,
  migrateNumberedTerminalWorkspaceDefaults,
  KeybindingsConfigPrettyJson,
  mergeWithDefaultKeybindings,
} from "../keybindingConfig";
import {
  ResolvedKeybindingFromConfig,
  compileResolvedKeybindingsConfig,
  hasSameShortcutContext,
  isSameKeybindingRule,
  compileResolvedKeybindingRule,
  isSameResolvedKeybindingRule,
} from "../keybindingCompiler";
import { DEFAULT_KEYBINDINGS } from "../defaultKeybindings";

const makeKeybindings = Effect.gen(function* () {
  const { keybindingsConfigPath } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const upsertSemaphore = yield* Semaphore.make(1);
  const resolvedConfigCacheKey = "resolved" as const;
  const changesPubSub = yield* PubSub.unbounded<KeybindingsChangeEvent>();
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, KeybindingsConfigError>();
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));
  const emitChange = (configState: KeybindingsConfigState) =>
    PubSub.publish(changesPubSub, configState).pipe(Effect.asVoid);

  const readConfigExists = fs.exists(keybindingsConfigPath).pipe(
    Effect.mapError(
      (cause) =>
        new KeybindingsConfigError({
          configPath: keybindingsConfigPath,
          detail: "failed to access keybindings config",
          cause,
        }),
    ),
  );

  const readRawConfig = fs.readFileString(keybindingsConfigPath).pipe(
    Effect.mapError(
      (cause) =>
        new KeybindingsConfigError({
          configPath: keybindingsConfigPath,
          detail: "failed to read keybindings config",
          cause,
        }),
    ),
  );

  const loadWritableCustomKeybindingsConfig = Effect.fn(function* (): Effect.fn.Return<
    readonly KeybindingRule[],
    KeybindingsConfigError
  > {
    if (!(yield* readConfigExists)) {
      return [];
    }

    const rawConfig = yield* readRawConfig;
    const decodedEntries = decodeRawKeybindingsEntries(rawConfig);
    if (decodedEntries._tag === "failure") {
      return yield* new KeybindingsConfigError({
        configPath: keybindingsConfigPath,
        detail: decodedEntries.detail,
      });
    }

    return yield* Effect.forEach(decodedEntries.entries, (entry) =>
      Effect.gen(function* () {
        const command = readKeybindingEntryCommand(entry);
        if (command !== null && isRetiredLegacyKeybindingCommand(command)) {
          return null;
        }

        const normalized = normalizeLegacyKeybindingEntry(entry);
        const decodedRule = Schema.decodeUnknownExit(KeybindingRule)(normalized.entry);
        if (decodedRule._tag === "Failure") {
          yield* Effect.logWarning("ignoring invalid keybinding entry", {
            path: keybindingsConfigPath,
            entry,
            error: Cause.pretty(decodedRule.cause),
          });
          return null;
        }
        const resolved = Schema.decodeExit(ResolvedKeybindingFromConfig)(decodedRule.value);
        if (resolved._tag === "Failure") {
          yield* Effect.logWarning("ignoring invalid keybinding entry", {
            path: keybindingsConfigPath,
            entry,
            error: Cause.pretty(resolved.cause),
          });
          return null;
        }
        return decodedRule.value;
      }),
    ).pipe(Effect.map(Array.filter(Predicate.isNotNull)));
  });

  const loadRuntimeCustomKeybindingsConfig = Effect.fn(function* (): Effect.fn.Return<
    {
      readonly keybindings: readonly KeybindingRule[];
      readonly issues: readonly ServerConfigIssue[];
      readonly migratedLegacyCommandCount: number;
      readonly migratedDefaultRuleCount: number;
      readonly migratedConfigShape: boolean;
    },
    KeybindingsConfigError
  > {
    if (!(yield* readConfigExists)) {
      return {
        keybindings: [],
        issues: [],
        migratedLegacyCommandCount: 0,
        migratedDefaultRuleCount: 0,
        migratedConfigShape: false,
      };
    }

    const rawConfig = yield* readRawConfig;
    const decodedEntries = decodeRawKeybindingsEntries(rawConfig);
    if (decodedEntries._tag === "failure") {
      return {
        keybindings: [],
        issues: [malformedConfigIssue(decodedEntries.detail)],
        migratedLegacyCommandCount: 0,
        migratedDefaultRuleCount: 0,
        migratedConfigShape: false,
      };
    }
    if (decodedEntries.migratedShape) {
      yield* Effect.logWarning("migrating keybindings config with non-array top-level shape", {
        path: keybindingsConfigPath,
      });
    }

    const keybindings: KeybindingRule[] = [];
    const issues: ServerConfigIssue[] = [];
    let migratedLegacyCommandCount = 0;
    let migratedDefaultRuleCount = 0;
    for (const [index, entry] of decodedEntries.entries.entries()) {
      const command = readKeybindingEntryCommand(entry);
      if (command !== null && isRetiredLegacyKeybindingCommand(command)) {
        migratedLegacyCommandCount += 1;
        continue;
      }

      const normalized = normalizeLegacyKeybindingEntry(entry);
      if (normalized.migrated) {
        migratedLegacyCommandCount += 1;
      }
      const decodedRule = Schema.decodeUnknownExit(KeybindingRule)(normalized.entry);
      if (decodedRule._tag === "Failure") {
        const detail = Cause.pretty(decodedRule.cause);
        const schemaError = Option.getOrUndefined(Cause.findErrorOption(decodedRule.cause));
        const normalizedCommand = readKeybindingEntryCommand(normalized.entry);
        issues.push(
          invalidEntryIssue(
            index,
            normalizedCommand !== null && !Schema.is(KeybindingCommand)(normalizedCommand)
              ? `Unknown shortcut command ${JSON.stringify(normalizedCommand.slice(0, 64))}.`
              : schemaError
                ? SchemaIssue.makeFormatterDefault()(schemaError.issue)
                : "Invalid shortcut rule.",
          ),
        );
        yield* Effect.logWarning("ignoring invalid keybinding entry", {
          path: keybindingsConfigPath,
          index,
          entry,
          error: detail,
        });
        continue;
      }

      const resolvedRule = Schema.decodeExit(ResolvedKeybindingFromConfig)(decodedRule.value);
      if (resolvedRule._tag === "Failure") {
        const detail = Cause.pretty(resolvedRule.cause);
        const schemaError = Option.getOrUndefined(Cause.findErrorOption(resolvedRule.cause));
        issues.push(
          invalidEntryIssue(
            index,
            schemaError
              ? SchemaIssue.makeFormatterDefault()(schemaError.issue)
              : "Invalid shortcut rule.",
          ),
        );
        yield* Effect.logWarning("ignoring invalid keybinding entry", {
          path: keybindingsConfigPath,
          index,
          entry,
          error: detail,
        });
        continue;
      }
      const migratedDefaultRule = migrateOutdatedDefaultKeybindingRule(decodedRule.value);
      if (migratedDefaultRule.migrated) {
        migratedDefaultRuleCount += 1;
      }
      keybindings.push(migratedDefaultRule.rule);
    }

    const sidebarSearchMigration = migrateOutdatedSidebarSearchDefault(keybindings);
    migratedDefaultRuleCount += sidebarSearchMigration.migratedCount;
    const relaxed = relaxCreationCommandTerminalGuards(sidebarSearchMigration.rules);
    migratedDefaultRuleCount += relaxed.migratedCount;
    const numberedTerminalWorkspaceMigration = migrateNumberedTerminalWorkspaceDefaults(
      relaxed.rules,
    );
    migratedDefaultRuleCount += numberedTerminalWorkspaceMigration.migratedCount;

    return {
      keybindings: numberedTerminalWorkspaceMigration.rules,
      issues,
      migratedLegacyCommandCount,
      migratedDefaultRuleCount,
      migratedConfigShape: decodedEntries.migratedShape,
    };
  });

  const writeConfigAtomically = (rules: readonly KeybindingRule[]) => {
    return Schema.encodeEffect(KeybindingsConfigPrettyJson)(rules).pipe(
      Effect.map((encoded) => `${encoded}\n`),
      Effect.flatMap((encoded) =>
        writeFileStringAtomically({ filePath: keybindingsConfigPath, contents: encoded }),
      ),
      Effect.mapError(
        (cause) =>
          new KeybindingsConfigError({
            configPath: keybindingsConfigPath,
            detail: "failed to write keybindings config",
            cause,
          }),
      ),
    );
  };

  const loadConfigStateFromDisk = loadRuntimeCustomKeybindingsConfig().pipe(
    Effect.map(({ keybindings, issues }) => ({
      keybindings: mergeWithDefaultKeybindings(compileResolvedKeybindingsConfig(keybindings)),
      issues,
    })),
  );

  const resolvedConfigCache = yield* Cache.make<
    typeof resolvedConfigCacheKey,
    KeybindingsConfigState,
    KeybindingsConfigError
  >({
    capacity: 1,
    lookup: () => loadConfigStateFromDisk,
  });

  const loadConfigStateFromCacheOrDisk = Cache.get(resolvedConfigCache, resolvedConfigCacheKey);

  const revalidateAndEmit = upsertSemaphore.withPermits(1)(
    Effect.gen(function* () {
      yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
      const configState = yield* loadConfigStateFromCacheOrDisk;
      yield* emitChange(configState);
    }),
  );

  const syncDefaultKeybindingsOnStartup = upsertSemaphore.withPermits(1)(
    Effect.gen(function* () {
      const configExists = yield* readConfigExists;
      if (!configExists) {
        yield* writeConfigAtomically(DEFAULT_KEYBINDINGS);
        yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
        return;
      }

      const runtimeConfig = yield* loadRuntimeCustomKeybindingsConfig();
      if (runtimeConfig.issues.length > 0) {
        yield* Effect.logWarning(
          "skipping startup keybindings default sync because config has issues",
          {
            path: keybindingsConfigPath,
            issues: runtimeConfig.issues,
          },
        );
        yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
        return;
      }
      const customConfig = runtimeConfig.keybindings;
      const existingCommands = new Set(customConfig.map((entry) => entry.command));
      const missingDefaults: KeybindingRule[] = [];
      const shortcutConflictWarnings: Array<{
        defaultCommand: KeybindingRule["command"];
        conflictingCommand: KeybindingRule["command"];
        key: string;
        when: string | null;
      }> = [];
      for (const defaultRule of DEFAULT_KEYBINDINGS) {
        if (existingCommands.has(defaultRule.command)) {
          continue;
        }
        const conflictingEntry = customConfig.find((entry) =>
          hasSameShortcutContext(entry, defaultRule),
        );
        if (conflictingEntry) {
          shortcutConflictWarnings.push({
            defaultCommand: defaultRule.command,
            conflictingCommand: conflictingEntry.command,
            key: defaultRule.key,
            when: defaultRule.when ?? null,
          });
          continue;
        }
        missingDefaults.push(defaultRule);
      }
      for (const conflict of shortcutConflictWarnings) {
        yield* Effect.logWarning("skipping default keybinding due to shortcut conflict", {
          path: keybindingsConfigPath,
          defaultCommand: conflict.defaultCommand,
          conflictingCommand: conflict.conflictingCommand,
          key: conflict.key,
          when: conflict.when,
          reason: "shortcut context already used by existing rule",
        });
      }
      if (missingDefaults.length === 0) {
        if (
          runtimeConfig.migratedLegacyCommandCount > 0 ||
          runtimeConfig.migratedDefaultRuleCount > 0 ||
          runtimeConfig.migratedConfigShape
        ) {
          yield* writeConfigAtomically(customConfig);
        }
        yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
        return;
      }

      const matchingDefaults = DEFAULT_KEYBINDINGS.filter((defaultRule) =>
        customConfig.some((entry) => isSameKeybindingRule(entry, defaultRule)),
      ).map((rule) => rule.command);
      if (matchingDefaults.length > 0) {
        yield* Effect.logWarning("default keybinding rule already defined in user config", {
          path: keybindingsConfigPath,
          commands: matchingDefaults,
        });
      }

      const nextConfig = [...customConfig, ...missingDefaults];
      // Runtime merging supplies missing defaults when the user file has no room. Never evict
      // saved rules to make room for built-ins, or persist only half a platform pair.
      const persistedConfig =
        nextConfig.length <= MAX_KEYBINDINGS_COUNT ? nextConfig : customConfig;

      const migratedKeybindingCount =
        runtimeConfig.migratedLegacyCommandCount + runtimeConfig.migratedDefaultRuleCount;
      if (migratedKeybindingCount > 0) {
        yield* Effect.logInfo("migrated keybinding config entries", {
          path: keybindingsConfigPath,
          count: migratedKeybindingCount,
        });
      }
      if (
        persistedConfig !== customConfig ||
        migratedKeybindingCount > 0 ||
        runtimeConfig.migratedConfigShape
      ) {
        yield* writeConfigAtomically(persistedConfig);
      }
      yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
    }),
  );

  const startWatcher = Effect.gen(function* () {
    const keybindingsConfigDir = path.dirname(keybindingsConfigPath);
    const keybindingsConfigFile = path.basename(keybindingsConfigPath);
    const keybindingsConfigPathResolved = path.resolve(keybindingsConfigPath);

    yield* fs.makeDirectory(keybindingsConfigDir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new KeybindingsConfigError({
            configPath: keybindingsConfigPath,
            detail: "failed to prepare keybindings config directory",
            cause,
          }),
      ),
    );

    const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }));

    yield* Stream.runForEach(fs.watch(keybindingsConfigDir), (event) => {
      const isTargetConfigEvent =
        event.path === keybindingsConfigFile ||
        event.path === keybindingsConfigPath ||
        path.resolve(keybindingsConfigDir, event.path) === keybindingsConfigPathResolved;
      if (!isTargetConfigEvent) {
        return Effect.void;
      }
      return revalidateAndEmitSafely;
    }).pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(watcherScope), Effect.asVoid);
  });

  const start = Effect.gen(function* () {
    const alreadyStarted = yield* Ref.get(startedRef);
    if (alreadyStarted) {
      return yield* Deferred.await(startedDeferred);
    }

    yield* Ref.set(startedRef, true);
    const startup = Effect.gen(function* () {
      yield* startWatcher;
      yield* syncDefaultKeybindingsOnStartup;
      yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
      yield* loadConfigStateFromCacheOrDisk;
    });

    const startupExit = yield* Effect.exit(startup);
    if (startupExit._tag === "Failure") {
      yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
      return yield* Effect.failCause(startupExit.cause);
    }

    yield* Deferred.succeed(startedDeferred, undefined).pipe(Effect.orDie);
  });

  const validateUpsertRule = (rule: KeybindingRule) =>
    compileResolvedKeybindingRule(rule) === null
      ? Effect.fail(
          new KeybindingsConfigError({
            configPath: keybindingsConfigPath,
            detail: "invalid shortcut or condition expression",
          }),
        )
      : Effect.void;

  const keepExistingRuleDuringUpsert = (
    existingRule: KeybindingRule,
    rule: KeybindingRule,
    replacing: KeybindingRule | undefined,
  ) =>
    replacing
      ? !isSameResolvedKeybindingRule(existingRule, replacing)
      : existingRule.command !== rule.command;

  return {
    start,
    ready: Deferred.await(startedDeferred),
    syncDefaultKeybindingsOnStartup,
    loadConfigState: loadConfigStateFromCacheOrDisk,
    getSnapshot: loadConfigStateFromCacheOrDisk,
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
    upsertKeybindingRule: (rule, replacing) =>
      upsertSemaphore.withPermits(1)(
        Effect.gen(function* () {
          yield* validateUpsertRule(rule);
          if (replacing) yield* validateUpsertRule(replacing);
          const customConfig = yield* loadWritableCustomKeybindingsConfig();
          const nextConfig = [
            ...customConfig.filter((entry) => keepExistingRuleDuringUpsert(entry, rule, replacing)),
            rule,
          ];
          if (nextConfig.length > MAX_KEYBINDINGS_COUNT) {
            return yield* Effect.fail(
              new KeybindingsConfigError({
                configPath: keybindingsConfigPath,
                detail: `Keybindings are limited to ${MAX_KEYBINDINGS_COUNT} saved rules. Remove a rule before adding another.`,
              }),
            );
          }
          yield* writeConfigAtomically(nextConfig);
          const nextResolved = mergeWithDefaultKeybindings(
            compileResolvedKeybindingsConfig(nextConfig),
          );
          yield* Cache.set(resolvedConfigCache, resolvedConfigCacheKey, {
            keybindings: nextResolved,
            issues: [],
          });
          yield* emitChange({
            keybindings: nextResolved,
            issues: [],
          });
          return nextResolved;
        }),
      ),
  } satisfies KeybindingsShape;
});

export const KeybindingsLive = Layer.effect(Keybindings, makeKeybindings);
