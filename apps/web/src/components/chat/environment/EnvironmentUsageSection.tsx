import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { providerUsageDisplayName } from "@glade/shared/provider/providerUsage";
import { useQuery } from "@tanstack/react-query";

import {
  ProviderUsageMenuPopup,
  useProviderUsageMenuModel,
} from "~/components/ProviderUsageMenuControl";
import { ProviderIcon } from "~/components/ProviderIcon";
import { MenuTrigger } from "~/components/ui/menu";
import {
  serverAllProviderUsageQueryOptions,
  serverSettingsQueryOptions,
} from "~/lib/serverReactQuery";

import { resolveEnvironmentProviderUsageSummary } from "./EnvironmentUsageSection.logic";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentLabeledSection,
  EnvironmentRowBody,
  EnvironmentRowChevron,
} from "./EnvironmentRow";

export function EnvironmentUsageSection({ provider }: { provider: ProviderKind }) {
  const usageQuery = useQuery(serverAllProviderUsageQueryOptions());
  const settingsQuery = useQuery(serverSettingsQueryOptions());

  const snapshot = (usageQuery.data ?? []).find((entry) => entry.provider === provider);
  const model = useProviderUsageMenuModel(provider, { providerSnapshot: snapshot });

  if (settingsQuery.data?.providers[provider].enabled === false) {
    return null;
  }

  if (model.rows.length === 0) {
    return null;
  }

  const providerName = providerUsageDisplayName(provider);
  const summary = resolveEnvironmentProviderUsageSummary({
    providerName,
    rows: model.rows,
  });

  return (
    <EnvironmentLabeledSection label="Usage">
      <ProviderUsageMenuPopup provider={provider} model={model} align="start">
        <MenuTrigger
          render={
            <button
              type="button"
              className={ENVIRONMENT_ROW_CLASS_NAME}
              aria-label={summary.ariaLabel}
            />
          }
        >
          <EnvironmentRowBody
            icon={
              <ProviderIcon
                provider={provider}
                tone="header"
                className={ENVIRONMENT_ROW_ICON_CLASS_NAME}
              />
            }
            label={providerName}
            trailing={
              <span className="flex items-center gap-1.5">
                <span className="flex flex-col items-end gap-0.5 text-chat-meta leading-none">
                  {summary.rows.map((row) => (
                    <span key={row.id} className="flex items-baseline gap-1.5">
                      <span className="text-[var(--color-text-foreground-secondary)]">
                        {row.label}
                      </span>
                      <span className="min-w-7 text-right text-[var(--color-text-foreground)]">
                        {row.remainingLabel}
                      </span>
                    </span>
                  ))}
                </span>
                <EnvironmentRowChevron />
              </span>
            }
          />
        </MenuTrigger>
      </ProviderUsageMenuPopup>
    </EnvironmentLabeledSection>
  );
}
