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

function skillDescriptor(skill: SkillMetadata): ProviderSkillDescriptor {
  return {
    name: skill.name,
    path: skill.path,
    enabled: skill.enabled,
    ...(present(skill.description) ? { description: skill.description } : {}),
    ...(present(skill.scope) ? { scope: skill.scope } : {}),
    ...(skill.interface
      ? {
          interface: {
            ...(present(skill.interface.displayName)
              ? { displayName: skill.interface.displayName }
              : {}),
            ...(present(skill.interface.shortDescription)
              ? { shortDescription: skill.interface.shortDescription }
              : {}),
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
  return {
    ...(present(value.displayName) ? { displayName: value.displayName! } : {}),
    ...(present(value.shortDescription) ? { shortDescription: value.shortDescription! } : {}),
    ...(present(value.longDescription) ? { longDescription: value.longDescription! } : {}),
    ...(present(value.developerName) ? { developerName: value.developerName! } : {}),
    ...(present(value.category) ? { category: value.category! } : {}),
    ...(value.capabilities?.length ? { capabilities: value.capabilities } : {}),
    ...(present(value.websiteUrl) ? { websiteUrl: value.websiteUrl! } : {}),
    ...(present(value.privacyPolicyUrl) ? { privacyPolicyUrl: value.privacyPolicyUrl! } : {}),
    ...(present(value.termsOfServiceUrl) ? { termsOfServiceUrl: value.termsOfServiceUrl! } : {}),
    ...(value.defaultPrompt?.length ? { defaultPrompt: value.defaultPrompt } : {}),
    ...(present(value.brandColor) ? { brandColor: value.brandColor! } : {}),
    ...(present(value.composerIcon ?? value.composerIconUrl)
      ? { composerIcon: (value.composerIcon ?? value.composerIconUrl)! }
      : {}),
    ...(present(value.logo ?? value.logoUrl) ? { logo: (value.logo ?? value.logoUrl)! } : {}),
    ...(value.screenshots?.length || value.screenshotUrls?.length
      ? { screenshots: [...(value.screenshots ?? []), ...(value.screenshotUrls ?? [])] }
      : {}),
  };
}

function pluginDescriptor(plugin: PluginSummary): ProviderPluginDescriptor {
  return {
    id: plugin.id,
    name: plugin.name,
    source: plugin.source,
    installed: plugin.installed,
    enabled: plugin.enabled,
    installPolicy: plugin.installPolicy,
    authPolicy: plugin.authPolicy,
    ...(pluginInterface(plugin.interface) ? { interface: pluginInterface(plugin.interface) } : {}),
  };
}

export function parseCodexPluginListResponse(
  response: PluginListResponse,
): Omit<ProviderListPluginsResult, "source" | "cached"> {
  return {
    marketplaces: response.marketplaces.map((entry) => ({
      name: entry.name,
      path: entry.path ?? null,
      ...(present(entry.interface?.displayName)
        ? { interface: { displayName: entry.interface!.displayName! } }
        : {}),
      plugins: entry.plugins.map(pluginDescriptor),
    })),
    marketplaceLoadErrors: (response.marketplaceLoadErrors ?? []).map((error) => ({
      marketplacePath: error.marketplacePath,
      message: error.message,
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
    ...(present(plugin.description) ? { description: plugin.description! } : {}),
    skills: plugin.skills.flatMap((skill) =>
      skill.path
        ? [
            {
              name: skill.name,
              path: skill.path,
              enabled: skill.enabled,
              ...(present(skill.description) ? { description: skill.description } : {}),
              ...(skill.interface
                ? {
                    interface: {
                      ...(present(skill.interface.displayName)
                        ? { displayName: skill.interface.displayName! }
                        : {}),
                      ...(present(skill.interface.shortDescription)
                        ? { shortDescription: skill.interface.shortDescription! }
                        : {}),
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
      ...(present(app.description) ? { description: app.description! } : {}),
      ...(present(app.installUrl) ? { installUrl: app.installUrl! } : {}),
      needsAuth: false,
    })),
    mcpServers: plugin.mcpServers,
  };
}

export function parseCodexModelListResponse(
  response: ModelListResponse,
): ProviderListModelsResult["models"] {
  return response.data.map((model) => {
    const supportedReasoningEfforts = model.supportedReasoningEfforts.map((effort) => ({
      value: effort.reasoningEffort,
      description: effort.description,
    }));
    const serviceTiers = (model.serviceTiers ?? []).map((tier) => ({
      id: tier.id,
      label: tier.name,
      ...(present(tier.description) ? { description: tier.description } : {}),
      ...(tier.id === model.defaultServiceTier ? { isDefault: true as const } : {}),
    }));
    return {
      slug: model.id,
      name: model.displayName,
      description: model.description,
      isDefault: model.isDefault,
      hidden: model.hidden,
      supportedReasoningEfforts,
      defaultReasoningEffort: model.defaultReasoningEffort,
      ...(serviceTiers.length ? { serviceTiers } : {}),
      ...(present(model.defaultServiceTier)
        ? { defaultServiceTier: model.defaultServiceTier! }
        : {}),
      ...(present(model.upgrade) ? { upgrade: model.upgrade! } : {}),
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning effort",
          type: "select" as const,
          options: supportedReasoningEfforts.map((effort) => ({
            id: effort.value,
            label: effort.value,
            ...(present(effort.description) ? { description: effort.description } : {}),
            ...(effort.value === model.defaultReasoningEffort ? { isDefault: true as const } : {}),
          })),
        },
        ...(serviceTiers.length
          ? [
              {
                id: "serviceTier",
                label: "Service tier",
                type: "select" as const,
                options: serviceTiers,
              },
            ]
          : []),
      ],
    };
  });
}
