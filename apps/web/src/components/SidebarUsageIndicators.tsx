import { useAppSettings } from "~/appSettings";
import { ProviderUsageMenuControl } from "./ProviderUsageMenuControl";

export function SidebarUsageIndicators() {
  const { settings } = useAppSettings();
  return (
    <div className="flex shrink-0 items-center gap-1.5 empty:hidden">
      {settings.sidebarUsageProviders
        .filter((provider) => !settings.disabledProviders.includes(provider))
        .map((provider) => (
          <ProviderUsageMenuControl key={provider} provider={provider} surface="sidebar" />
        ))}
    </div>
  );
}
