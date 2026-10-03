import { useAppSettings } from "~/appSettings";
import { ProviderUsageMenuControl } from "./ProviderUsageMenuControl";

export function SidebarUsageIndicators() {
  const { settings } = useAppSettings();
  return (
    <div className="flex items-center gap-1 empty:hidden">
      {settings.sidebarUsageProviders
        .filter((provider) => !settings.disabledProviders.includes(provider))
        .map((provider) => (
          <ProviderUsageMenuControl key={provider} provider={provider} surface="sidebar" />
        ))}
    </div>
  );
}
