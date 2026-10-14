import { formatEffortLabel, middleEffort } from "@glade/shared/provider/effortLabel";
import type {
  ProviderListModelsResult,
  ProviderListPluginsResult,
  ProviderPluginDescriptor,
  ProviderPluginDetail,
  ProviderSkillDescriptor,
} from "@glade/contracts/provider/providerDiscovery";
import type { ModelListResponse } from "./protocol/generated/types/v2/ModelListResponse";
import type { SkillsListResponse } from "./protocol/generated/types/v2/SkillsListResponse";
import type { SkillMetadata } from "./protocol/generated/types/v2/SkillMetadata";
import type { PluginListResponse } from "./protocol/generated/types/v2/PluginListResponse";
import type { PluginReadResponse } from "./protocol/generated/types/v2/PluginReadResponse";
import type { PluginSummary } from "./protocol/generated/types/v2/PluginSummary";
import type { PluginInterface } from "./protocol/generated/types/v2/PluginInterface";

function present(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}

// Catalog text is the provider's data and the contracts reject untrimmed strings, so one plugin
// description ending in a space failed the whole list of thousands. Fields carry the trimmed text.
function optionalText<K extends string>(
  key: K,
  value: string | null | undefined,
): { [P in K]?: string } {
  const text = present(value);
  // A computed generic key widens to a string index signature.
  return text === undefined ? {} : ({ [key]: text } as { [P in K]: string });
}

function presentList(values: ReadonlyArray<string> | null | undefined): string[] {
  return (values ?? []).flatMap((value) => present(value) ?? []);
}

function skillDescriptor(skill: SkillMetadata): ProviderSkillDescriptor {
  return {
    name: skill.name,
    path: skill.path,
    enabled: skill.enabled,
    ...optionalText("description", skill.description),
    ...optionalText("scope", skill.scope),
    ...(skill.interface
      ? {
          interface: {
            ...optionalText("displayName", skill.interface.displayName),
            ...optionalText("shortDescription", skill.interface.shortDescription),
          },
        }
      : {}),
    ...(skill.dependencies ? { dependencies: skill.dependencies } : {}),
  };
}

export function parseCodexSkillsListResponse(
  response: SkillsListResponse,
  cwd: string,
): ProviderSkillDescriptor[] {
  const entry = response.data.find((item) => item.cwd === cwd);
  if (!entry) throw new Error(`skills/list omitted requested cwd: ${cwd}`);
  return entry.skills.map(skillDescriptor).toSorted((a, b) => a.name.localeCompare(b.name));
}

function pluginInterface(value: PluginInterface | null): ProviderPluginDescriptor["interface"] {
  if (!value) return undefined;
  const capabilities = presentList(value.capabilities);
  const defaultPrompt = presentList(value.defaultPrompt);
  const screenshots = presentList([...(value.screenshots ?? []), ...(value.screenshotUrls ?? [])]);
  return {
    ...optionalText("displayName", value.displayName),
    ...optionalText("shortDescription", value.shortDescription),
    ...optionalText("longDescription", value.longDescription),
    ...optionalText("developerName", value.developerName),
    ...optionalText("category", value.category),
    ...(capabilities.length ? { capabilities } : {}),
    ...optionalText("websiteUrl", value.websiteUrl),
    ...optionalText("privacyPolicyUrl", value.privacyPolicyUrl),
    ...optionalText("termsOfServiceUrl", value.termsOfServiceUrl),
    ...(defaultPrompt.length ? { defaultPrompt } : {}),
    ...optionalText("brandColor", value.brandColor),
    ...optionalText("composerIcon", value.composerIcon ?? value.composerIconUrl),
    ...optionalText("logo", value.logo ?? value.logoUrl),
    ...(screenshots.length ? { screenshots } : {}),
  };
}

function pluginDescriptor(plugin: PluginSummary): ProviderPluginDescriptor {
  const pluginInterfaceFields = pluginInterface(plugin.interface);
  return {
    id: plugin.id,
    name: plugin.name,
    source: plugin.source,
    installed: plugin.installed,
    enabled: plugin.enabled,
    installPolicy: plugin.installPolicy,
    authPolicy: plugin.authPolicy,
    ...(pluginInterfaceFields ? { interface: pluginInterfaceFields } : {}),
  };
}

export function parseCodexPluginListResponse(
  response: PluginListResponse,
): Omit<ProviderListPluginsResult, "source" | "cached"> {
  return {
    marketplaces: response.marketplaces.map((entry) => {
      const displayName = present(entry.interface?.displayName);
      return {
        name: entry.name,
        path: entry.path ?? null,
        ...(displayName ? { interface: { displayName } } : {}),
        plugins: entry.plugins.map(pluginDescriptor),
      };
    }),
    marketplaceLoadErrors: (response.marketplaceLoadErrors ?? []).map((error) => ({
      marketplacePath: error.marketplacePath,
      message: error.message.trim(),
    })),
    remoteSyncError: null,
    featuredPluginIds: response.featuredPluginIds ?? [],
  };
}

export function parseCodexPluginReadResponse(response: PluginReadResponse): ProviderPluginDetail {
  const plugin = response.plugin;
  return {
    marketplaceName: plugin.marketplaceName,
    marketplacePath: plugin.marketplacePath ?? null,
    summary: pluginDescriptor(plugin.summary),
    ...optionalText("description", plugin.description),
    skills: plugin.skills.flatMap((skill) =>
      skill.path
        ? [
            {
              name: skill.name,
              path: skill.path,
              enabled: skill.enabled,
              ...optionalText("description", skill.description),
              ...(skill.interface
                ? {
                    interface: {
                      ...optionalText("displayName", skill.interface.displayName),
                      ...optionalText("shortDescription", skill.interface.shortDescription),
                    },
                  }
                : {}),
            },
          ]
        : [],
    ),
    apps: plugin.apps.map((app) => ({
      id: app.id,
      name: app.name,
      ...optionalText("description", app.description),
      ...optionalText("installUrl", app.installUrl),
      needsAuth: false,
    })),
    mcpServers: plugin.mcpServers,
  };
}

export function parseCodexModelListResponse(
  response: ModelListResponse,
  configuredEffort?: string | null,
): ProviderListModelsResult["models"] {
  return response.data.map((model) => {
    const defaultReasoningEffort = middleEffort(model.supportedReasoningEfforts)?.reasoningEffort;
    const supportedReasoningEfforts = model.supportedReasoningEfforts.map((effort) => {
      const label =
        "displayName" in effort && typeof effort.displayName === "string"
          ? present(effort.displayName)
          : undefined;
      return {
        value: effort.reasoningEffort,
        ...(label ? { label } : {}),
        description: effort.description,
      };
    });
    const serviceTiers = (model.serviceTiers ?? []).map((tier) => ({
      id: tier.id,
      label: tier.name,
      ...optionalText("description", tier.description),
      ...(tier.id === model.defaultServiceTier ? { isDefault: true as const } : {}),
    }));
    return {
      slug: model.id,
      name: model.displayName,
      description: model.description,
      isDefault: model.isDefault,
      hidden: model.hidden,
      supportedReasoningEfforts,
      ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
      ...(serviceTiers.length ? { serviceTiers } : {}),
      ...optionalText("defaultServiceTier", model.defaultServiceTier),
      ...optionalText("upgrade", model.upgrade),
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning effort",
          type: "select" as const,
          ...(configuredEffort &&
          supportedReasoningEfforts.some((effort) => effort.value === configuredEffort)
            ? { currentValue: configuredEffort }
            : {}),
          options: supportedReasoningEfforts.map((effort) => ({
            id: effort.value,
            label: effort.label ?? formatEffortLabel(effort.value),
            ...optionalText("description", effort.description),
            ...(effort.value === defaultReasoningEffort ? { isDefault: true as const } : {}),
          })),
        },
        ...(serviceTiers.length
          ? [
              {
                id: "serviceTier",
                label: "Speed",
                type: "select" as const,
                options: serviceTiers,
              },
            ]
          : []),
      ],
    };
  });
}
