import { ProviderListPluginsResult } from "@glade/contracts/provider/providerDiscovery";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { parseCodexPluginListResponse } from "./codexDiscoveryCatalog";
import { decodeCodexResponse } from "./protocol/decode";

// Shaped like an entry of Codex's remote marketplace, whose text is not trimmed.
const remotePlugin = {
  id: "azure-cosmosdb@openai-curated-remote",
  remotePluginId: "plugins_1",
  version: "1.2.0",
  localVersion: null,
  name: "azure-cosmosdb",
  shareContext: null,
  source: { type: "remote" },
  installed: false,
  installedAt: null,
  enabled: false,
  installPolicy: "AVAILABLE",
  installPolicySource: null,
  mustShowInstallationInterstitial: false,
  authPolicy: "ON_INSTALL",
  availability: "AVAILABLE",
  disabledReason: null,
  eligiblePlanTypes: null,
  interface: {
    displayName: "Azure Cosmos DB",
    shortDescription: "Azure Cosmos DB plugin ",
    longDescription: "  ",
    developerName: null,
    category: null,
    capabilities: ["Read", " "],
    websiteUrl: null,
    privacyPolicyUrl: null,
    termsOfServiceUrl: " https://example.com/terms",
    defaultPrompt: [" Review my data model. "],
    brandColor: null,
    composerIcon: null,
    composerIconUrl: null,
    logo: null,
    logoDark: null,
    logoUrl: null,
    logoUrlDark: null,
    screenshots: [],
    screenshotUrls: [],
  },
  keywords: [],
};

describe("Codex plugin catalog", () => {
  it("stays within the contract when the provider's text has stray whitespace", () => {
    const response = decodeCodexResponse("plugin/list", {
      marketplaces: [
        {
          name: "openai-curated-remote",
          path: null,
          interface: { displayName: "OpenAI Curated Remote " },
          plugins: [remotePlugin],
        },
      ],
      marketplaceLoadErrors: [],
      featuredPluginIds: [],
    });

    const catalog = Schema.decodeUnknownSync(ProviderListPluginsResult)(
      parseCodexPluginListResponse(response),
    );

    expect(catalog.marketplaces[0]?.interface).toEqual({ displayName: "OpenAI Curated Remote" });
    expect(catalog.marketplaces[0]?.plugins[0]?.interface).toEqual({
      displayName: "Azure Cosmos DB",
      shortDescription: "Azure Cosmos DB plugin",
      capabilities: ["Read"],
      termsOfServiceUrl: "https://example.com/terms",
      defaultPrompt: ["Review my data model."],
    });
  });
});
