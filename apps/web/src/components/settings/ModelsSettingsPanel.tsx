import { normalizeModelSlug } from "@glade/shared/provider/model";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  type AppSettingsBinding,
  getGitTextGenerationModelOptions,
  isGitTextGenerationSettingsDirty,
} from "~/appSettings";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";

import { resolveProviderDiscoveryCwd } from "~/lib/providerDiscovery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";

import { SelectItem } from "../ui/select";
import { ProviderOptionLabel } from "../ProviderIcon";
import { SettingResetButton, SettingsSelectControl } from "./SettingControls";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

const NO_PROVIDERS: ReadonlyArray<ProviderKind> = [];

export function ModelsSettingsPanel({
  settings,
  defaults,
  updateSettings,
  active,
}: AppSettingsBinding & { readonly active: boolean }) {
  const serverConfigQuery = useQuery(serverConfigQueryOptions());

  const { textGenerationModel, textGenerationProvider } = settings;
  const supportedProviders = serverConfigQuery.data?.gitTextGenerationProviders ?? NO_PROVIDERS;
  const currentGitTextGenerationProvider = textGenerationProvider ?? "codex";
  const modelHint = textGenerationModel;
  const gitWritingModelHintByProvider = useMemo<Partial<Record<ProviderKind, string | null>>>(
    () => ({ [currentGitTextGenerationProvider]: modelHint }),
    [modelHint, currentGitTextGenerationProvider],
  );
  const providerModelDiscoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: null,
    activeProjectCwd: null,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });
  const { modelOptionsByProvider: gitWritingCatalogOptionsByProvider } = useProviderModelCatalog({
    selectedProvider: currentGitTextGenerationProvider,
    discoveryEnabled: active,
    cwd: providerModelDiscoveryCwd,
    modelHintByProvider: gitWritingModelHintByProvider,
    prefetchProviders: supportedProviders,
  });
  const gitTextGenerationModelOptions = useMemo(() => {
    const discoveredOptionsByProvider = {} as Record<
      ProviderKind,
      (typeof gitWritingCatalogOptionsByProvider)[ProviderKind]
    >;
    for (const provider of supportedProviders) {
      discoveredOptionsByProvider[provider] = gitWritingCatalogOptionsByProvider[provider];
    }
    return getGitTextGenerationModelOptions(
      settings,
      supportedProviders,
      discoveredOptionsByProvider,
    );
  }, [gitWritingCatalogOptionsByProvider, settings, supportedProviders]);
  const currentGitTextGenerationModel =
    normalizeModelSlug(textGenerationModel, currentGitTextGenerationProvider) ??
    gitWritingCatalogOptionsByProvider[currentGitTextGenerationProvider].find(
      (model) => model.isDefault,
    )?.slug ??
    "";
  const currentGitTextGenerationValue = `${currentGitTextGenerationProvider}:${currentGitTextGenerationModel}`;
  const isGitTextGenerationModelDirty = isGitTextGenerationSettingsDirty(settings, defaults);
  const selectedGitTextGenerationModelLabel =
    gitTextGenerationModelOptions.find(
      (option) =>
        option.provider === currentGitTextGenerationProvider &&
        option.slug === currentGitTextGenerationModel,
    )?.name ?? currentGitTextGenerationModel;

  if (!active) return null;

  return (
    <div className="space-y-6">
      <SettingsSection title="Git generation">
        <SettingsRow
          id="setting-git-writing-model"
          title="Git generation model"
          description="Generates commit messages, PR titles, and branch names; chat reply models stay unchanged."
          resetAction={
            isGitTextGenerationModelDirty ? (
              <SettingResetButton
                label="git writing model"
                onClick={() =>
                  updateSettings({
                    textGenerationProvider: defaults.textGenerationProvider,
                    textGenerationModel: defaults.textGenerationModel,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={currentGitTextGenerationValue}
              onValueChange={(value) => {
                if (!value) return;
                const separatorIndex = value.indexOf(":");
                const provider = value.slice(0, separatorIndex) as ProviderKind;
                const model = value.slice(separatorIndex + 1);
                if (!provider || !model) return;
                updateSettings({
                  textGenerationProvider: provider,
                  textGenerationModel: model,
                });
              }}
              ariaLabel="Git text generation model"
              triggerClassName="w-full sm:w-52"
              valueContent={
                <ProviderOptionLabel
                  provider={currentGitTextGenerationProvider}
                  label={selectedGitTextGenerationModelLabel}
                />
              }
            >
              {gitTextGenerationModelOptions.map((option) => (
                <SelectItem
                  hideIndicator
                  key={`${option.provider}:${option.slug}`}
                  value={`${option.provider}:${option.slug}`}
                >
                  <ProviderOptionLabel
                    provider={option.provider}
                    label={`${PROVIDER_DISPLAY_NAMES[option.provider]} / ${option.name}`}
                  />
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />
      </SettingsSection>
    </div>
  );
}
