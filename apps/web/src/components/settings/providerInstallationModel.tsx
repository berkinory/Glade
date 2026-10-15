import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DESCRIPTORS as VISIBLE_PROVIDER_DESCRIPTORS } from "@glade/shared/provider/providerMetadata";
import { DEFAULT_SERVER_SETTINGS } from "@glade/contracts/settings/settings";
import type { ReactNode } from "react";
import type { AppSettings } from "~/appSettings";

type ProviderInstallTextKey = "codexHomePath";
export type ProviderInstallField =
  | {
      readonly kind: "binaryPath";
      readonly id: string;
      readonly label: string;
      readonly placeholder: string;
      readonly description: ReactNode;
    }
  | {
      readonly kind: "text";
      readonly id: string;
      readonly settingsKey: ProviderInstallTextKey;
      readonly label: string;
      readonly placeholder: string;
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

// Settings that only one provider has, shown after its binary path.
const PROVIDER_EXTRA_INSTALL_FIELDS: Partial<
  Record<ProviderKind, readonly ProviderInstallField[]>
> = {
  codex: [
    {
      kind: "text",
      id: "codexHomePath",
      settingsKey: "codexHomePath",
      label: "CODEX_HOME path",
      placeholder: "CODEX_HOME",
      description: "Optional custom Codex home and config directory.",
    },
  ],
};

export const VISIBLE_PROVIDER_INSTALL_SETTINGS: readonly ProviderInstallSettings[] =
  VISIBLE_PROVIDER_DESCRIPTORS.map((descriptor) => ({
    provider: descriptor.kind,
    docs: descriptor.installDocs,
    fields: [
      {
        kind: "binaryPath",
        id: `${descriptor.kind}BinaryPath`,
        label: `${descriptor.displayName} binary path`,
        placeholder: `${descriptor.displayName} binary path`,
        description: (
          <>
            Leave blank to use{" "}
            <code>{DEFAULT_SERVER_SETTINGS.providers[descriptor.kind].binaryPath}</code> from your
            PATH.
          </>
        ),
      },
      ...(PROVIDER_EXTRA_INSTALL_FIELDS[descriptor.kind] ?? []),
    ],
  }));

export function readProviderInstallField(
  provider: ProviderKind,
  field: ProviderInstallField,
  settings: AppSettings,
): string {
  return field.kind === "binaryPath"
    ? (settings.providerBinaryPaths[provider] ?? "")
    : settings[field.settingsKey];
}

export function providerInstallFieldPatch(
  provider: ProviderKind,
  field: ProviderInstallField,
  value: string,
  settings: AppSettings,
): Partial<AppSettings> {
  if (field.kind === "binaryPath") {
    return { providerBinaryPaths: { ...settings.providerBinaryPaths, [provider]: String(value) } };
  }
  return { [field.settingsKey]: value };
}

export function isProviderInstallConfigDirty(
  config: ProviderInstallSettings,
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return config.fields.some(
    (field) =>
      readProviderInstallField(config.provider, field, settings) !==
      readProviderInstallField(config.provider, field, defaults),
  );
}

export function isProviderInstallSettingsDirty(
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return VISIBLE_PROVIDER_INSTALL_SETTINGS.some((config) =>
    isProviderInstallConfigDirty(config, settings, defaults),
  );
}

export function createProviderInstallDisclosureState(
  settings: AppSettings,
): Record<ProviderKind, boolean> {
  return Object.fromEntries(
    VISIBLE_PROVIDER_INSTALL_SETTINGS.map((config) => [
      config.provider,
      config.fields.some((field) =>
        Boolean(readProviderInstallField(config.provider, field, settings)),
      ),
    ]),
  ) as Record<ProviderKind, boolean>;
}

export function createClosedProviderInstallDisclosureState(): Record<ProviderKind, boolean> {
  return Object.fromEntries(
    VISIBLE_PROVIDER_INSTALL_SETTINGS.map((config) => [config.provider, false]),
  ) as Record<ProviderKind, boolean>;
}

export function createProviderInstallResetPatch(defaults: AppSettings): Partial<AppSettings> {
  const patch: Partial<AppSettings> = {};
  for (const config of VISIBLE_PROVIDER_INSTALL_SETTINGS) {
    for (const field of config.fields) {
      const value = readProviderInstallField(config.provider, field, defaults);
      Object.assign(patch, providerInstallFieldPatch(config.provider, field, value, defaults));
    }
  }
  return patch;
}

export function setProviderListMembership(
  current: ReadonlyArray<ProviderKind>,
  provider: ProviderKind,
  included: boolean,
): ProviderKind[] {
  const withoutTarget = current.filter((entry) => entry !== provider);
  return included ? [...withoutTarget, provider] : withoutTarget;
}
