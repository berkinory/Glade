import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { PROVIDER_DESCRIPTORS as VISIBLE_PROVIDER_DESCRIPTORS } from "@glade/shared/provider/providerMetadata";
import type { ReactNode } from "react";
import type { AppSettings } from "~/appSettings";

type ProviderInstallTextKey = "claudeBinaryPath" | "codexBinaryPath" | "codexHomePath";
type ProviderInstallBooleanKey = "claudeEnableArtifacts";
export type ProviderInstallField =
  | {
      readonly kind: "text";
      readonly settingsKey: ProviderInstallTextKey;
      readonly label: string;
      readonly placeholder: string;
      readonly description: ReactNode;
    }
  | {
      readonly kind: "boolean";
      readonly settingsKey: ProviderInstallBooleanKey;
      readonly label: string;
      readonly description: ReactNode;
    };
export type ProviderInstallSettings = {
  readonly provider: ProviderKind;
  readonly docs: ReadonlyArray<{ readonly label: string; readonly href: string }>;
  readonly fields: readonly ProviderInstallField[];
};

export const PROVIDER_VISIBILITY_OPTIONS = VISIBLE_PROVIDER_DESCRIPTORS.map((descriptor) => ({
  provider: descriptor.kind,
  title: descriptor.displayName,
  setupDocsHref: descriptor.setupDocsHref,
}));

const PROVIDER_INSTALL_SETTINGS: readonly ProviderInstallSettings[] = [
  {
    provider: "codex",
    docs: [
      { label: "Install", href: "https://developers.openai.com/codex/cli" },
      { label: "Update", href: "https://developers.openai.com/codex/cli" },
      { label: "Config", href: "https://github.com/openai/codex/blob/main/docs/config.md" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "codexBinaryPath",
        label: "Codex binary path",
        placeholder: "Codex binary path",
        description: (
          <>
            Leave blank to use <code>codex</code> from your PATH.
          </>
        ),
      },
      {
        kind: "text",
        settingsKey: "codexHomePath",
        label: "CODEX_HOME path",
        placeholder: "CODEX_HOME",
        description: "Optional custom Codex home and config directory.",
      },
    ],
  },
  {
    provider: "claudeAgent",
    docs: [
      { label: "Install", href: "https://code.claude.com/docs/en/installation" },
      { label: "Update", href: "https://code.claude.com/docs/en/installation#update-claude-code" },
      { label: "Config", href: "https://code.claude.com/docs/en/settings" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "claudeBinaryPath",
        label: "Claude binary path",
        placeholder: "Claude binary path",
        description: (
          <>
            Leave blank to use <code>claude</code> from your PATH.
          </>
        ),
      },
      {
        kind: "boolean",
        settingsKey: "claudeEnableArtifacts",
        label: "Artifacts, /design and /slides",
        description: (
          <>
            Claude Code keeps Artifacts off in embedded sessions. Turn this on so{" "}
            <code>/design</code> and <code>/slides</code> publish to claude.ai. Needs a claude.ai
            login on a Pro, Max, Team or Enterprise plan, and applies to new sessions.
          </>
        ),
      },
    ],
  },
];

export const VISIBLE_PROVIDER_INSTALL_SETTINGS = PROVIDER_INSTALL_SETTINGS;

function isProviderInstallFieldDirty(
  field: ProviderInstallField,
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return settings[field.settingsKey] !== defaults[field.settingsKey];
}

export function isProviderInstallConfigDirty(
  config: ProviderInstallSettings,
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return config.fields.some((field) => isProviderInstallFieldDirty(field, settings, defaults));
}

export function isProviderInstallSettingsDirty(
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return PROVIDER_INSTALL_SETTINGS.some((config) =>
    isProviderInstallConfigDirty(config, settings, defaults),
  );
}

export function createProviderInstallDisclosureState(
  settings: AppSettings,
): Record<ProviderKind, boolean> {
  return Object.fromEntries(
    PROVIDER_INSTALL_SETTINGS.map((config) => [
      config.provider,
      config.fields.some((field) => Boolean(settings[field.settingsKey])),
    ]),
  ) as Record<ProviderKind, boolean>;
}

export function createClosedProviderInstallDisclosureState(): Record<ProviderKind, boolean> {
  return Object.fromEntries(
    PROVIDER_INSTALL_SETTINGS.map((config) => [config.provider, false]),
  ) as Record<ProviderKind, boolean>;
}

export function createProviderInstallResetPatch(defaults: AppSettings): Partial<AppSettings> {
  return Object.fromEntries(
    PROVIDER_INSTALL_SETTINGS.flatMap((config) =>
      config.fields.map((field) => [field.settingsKey, defaults[field.settingsKey]]),
    ),
  ) as Partial<AppSettings>;
}

export function setProviderListMembership(
  current: ReadonlyArray<ProviderKind>,
  provider: ProviderKind,
  included: boolean,
): ProviderKind[] {
  const withoutTarget = current.filter((entry) => entry !== provider);
  return included ? [...withoutTarget, provider] : withoutTarget;
}

export function isProviderPickerProviderEnabled(
  providerStatus: Pick<ServerProviderStatus, "available"> | null | undefined,
  isHidden: boolean,
): boolean {
  return providerStatus?.available === true && !isHidden;
}
