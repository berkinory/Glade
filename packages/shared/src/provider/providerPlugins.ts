import type { ProviderPluginDescriptor } from "@glade/contracts/provider/providerDiscovery";

export function isInstalledProviderPlugin(
  plugin: Pick<ProviderPluginDescriptor, "installed" | "enabled" | "installPolicy">,
): boolean {
  return plugin.installed || plugin.enabled || plugin.installPolicy === "INSTALLED_BY_DEFAULT";
}
