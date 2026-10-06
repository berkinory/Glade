import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import {
  type ServerCodexResetCredits,
  type ServerGetProviderUsageSnapshotResult,
} from "@glade/contracts/server/server";
import { providerUsageNeedsAuthDetail } from "@glade/shared/provider/providerUsage";
import { type ReactNode } from "react";

import { useAppSettings } from "~/appSettings";
import {
  type ProviderUsageSummaryData,
  useProviderUsageSummary,
} from "~/hooks/useProviderUsageSummary";
import {
  deriveProviderUsageDisplayRows,
  selectPrimaryProviderUsageDisplayRow,
  type ProviderUsageDisplayRow,
} from "~/lib/providerUsageDisplay";
import type { OpenUsageUsageLine } from "~/lib/openUsageRateLimits";
import type { ProviderRateLimit } from "~/lib/rateLimits";
import { useStore } from "~/store";
import { createAccountRateLimitThreadsSelector } from "~/storeSelectors";

import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { ChatHeaderButton } from "./chat/chatHeaderControls";
import { ProviderIcon } from "./ProviderIcon";
import { ProviderUsagePanelContent } from "./ProviderUsagePanelContent";
import { Menu, MenuTrigger } from "./ui/menu";
import { TOOLTIP_OPEN_DELAY_MS, Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export interface ProviderUsageMenuModel {
  menuTitle: string;
  primaryRow: ProviderUsageDisplayRow | null;
  rows: ReadonlyArray<ProviderUsageDisplayRow>;
  rateLimits: ReadonlyArray<ProviderRateLimit>;
  usageLines: ReadonlyArray<OpenUsageUsageLine>;
  notice: string | undefined;
  emptyMessage: string | undefined;
  isLoading: boolean;
  resetCredits?: ServerCodexResetCredits | undefined;
}

function buildProviderUsageMenuModel(input: {
  provider: ProviderKind;
  providerSnapshot?: ServerGetProviderUsageSnapshotResult | undefined;
  usageSummary: ProviderUsageSummaryData & { readonly isLoading: boolean };
}): ProviderUsageMenuModel {
  const rows = deriveProviderUsageDisplayRows(input.usageSummary.rateLimits);

  return {
    menuTitle: `${PROVIDER_DISPLAY_NAMES[input.provider]} usage`,
    primaryRow: selectPrimaryProviderUsageDisplayRow(rows),
    rows,
    rateLimits: input.usageSummary.rateLimits,
    usageLines: input.usageSummary.usageLines,
    notice: input.usageSummary.usageNotice,
    emptyMessage: providerUsageEmptyMessage(input.provider, input.providerSnapshot),
    isLoading: input.usageSummary.isLoading,
    resetCredits: input.usageSummary.resetCredits,
  };
}

const selectAccountRateLimitThreads = createAccountRateLimitThreadsSelector();

function providerUsageEmptyMessage(
  provider: ProviderKind,
  snapshot: ServerGetProviderUsageSnapshotResult | undefined,
): string | undefined {
  switch (snapshot?.status) {
    case "needs-auth":
      return snapshot.detail ?? providerUsageNeedsAuthDetail(provider);
    case "unsupported":
      return snapshot.detail ?? "Live usage is not available for this provider configuration.";
    case "error":
      return snapshot.detail ?? "Usage is currently unavailable.";
    default:
      return undefined;
  }
}

export function useProviderUsageMenuModel(
  provider: ProviderKind,
  input: {
    providerSnapshot?: ServerGetProviderUsageSnapshotResult | undefined;
  } = {},
): ProviderUsageMenuModel {
  const { settings } = useAppSettings();
  const threads = useStore(selectAccountRateLimitThreads);
  const usageSummary = useProviderUsageSummary({
    provider,
    threads,
    codexHomePath: settings.codexHomePath || null,
    providerSnapshot: input.providerSnapshot,
    fetchOpenUsageData: false,
  });

  return buildProviderUsageMenuModel({
    provider,
    providerSnapshot: input.providerSnapshot,
    usageSummary,
  });
}

export function ProviderUsageMenuPopup({
  provider,
  model,
  align: alignProp,
  side = "bottom",
  showUsageLines = false,
  children,
}: {
  provider: ProviderKind;
  model: ProviderUsageMenuModel;
  align?: "start" | "end";
  side?: "top" | "bottom";
  showUsageLines?: boolean;
  children: ReactNode;
}) {
  const align = alignProp ?? "end";
  return (
    <Menu modal={false}>
      {children}
      <ComposerPickerMenuPopup align={align} side={side} className="w-64 min-w-64">
        <ProviderUsagePanelContent
          provider={provider}
          rateLimits={model.rateLimits}
          usageLines={
            showUsageLines
              ? model.usageLines
              : model.usageLines.filter((line) => line.label === "Credits")
          }
          notice={model.notice}
          emptyMessage={model.emptyMessage}
          isLoading={model.isLoading}
          resetCredits={model.resetCredits}
          resetCreditsSurface="popover"
          showTitle={false}
          className="px-2 pb-1 pt-1"
        />
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

export function ProviderUsageMenuControl({
  provider,
  surface = "header",
}: {
  provider: ProviderKind;
  surface?: "header" | "sidebar";
}) {
  const model = useProviderUsageMenuModel(provider);
  const { settings } = useAppSettings();
  if (surface === "sidebar") {
    const windows =
      settings.sidebarUsageWindow === "both"
        ? [300, 10080]
        : [settings.sidebarUsageWindow === "five-hour" ? 300 : 10080];
    const rows = windows.flatMap((duration) => {
      const row = model.rows.find((candidate) => candidate.windowDurationMins === duration);
      return row ? [{ duration, row }] : [];
    });
    const description =
      rows.length > 0
        ? rows
            .map(
              ({ row }) =>
                `${row.label}: ${row.remainingLabel} remaining${row.resetText ? `, ${row.resetText}` : ""}`,
            )
            .join("; ")
        : model.isLoading
          ? "Loading usage"
          : (model.emptyMessage ?? model.notice ?? "Usage unavailable");
    return (
      <ProviderUsageMenuPopup provider={provider} model={model} side="top" align="start">
        <MenuTrigger
          openOnHover
          delay={TOOLTIP_OPEN_DELAY_MS}
          render={
            <button
              type="button"
              aria-label={`${model.menuTitle}. ${description}`}
              className="relative flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <svg viewBox="0 0 36 36" className="absolute inset-0 size-6 -rotate-90" aria-hidden>
            {rows.map(({ duration, row }, index) => (
              <g key={duration}>
                <circle
                  cx="18"
                  cy="18"
                  r={index === 0 ? 16.5 : 11.5}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  opacity="0.15"
                />
                <circle
                  cx="18"
                  cy="18"
                  r={index === 0 ? 16.5 : 11.5}
                  fill="none"
                  pathLength="100"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${row.remainingPercent} 100`}
                  className={
                    row.remainingPercent <= 10
                      ? "text-red-500"
                      : duration === 300
                        ? "text-emerald-500"
                        : "text-blue-500"
                  }
                />
              </g>
            ))}
          </svg>
          <ProviderIcon provider={provider} className="size-2.5" />
        </MenuTrigger>
      </ProviderUsageMenuPopup>
    );
  }

  if (!model.primaryRow) {
    return null;
  }

  return (
    <ProviderUsageMenuPopup provider={provider} model={model}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ChatHeaderButton
                  type="button"
                  tone="plain"
                  className="gap-1.5 px-2"
                  aria-label={model.menuTitle}
                />
              }
            >
              <ProviderIcon provider={provider} tone="header" className="size-3.5 shrink-0" />
              <span className="truncate font-normal">{model.primaryRow.remainingLabel}</span>
            </MenuTrigger>
          }
        />
        <TooltipPopup side="bottom">{model.menuTitle}</TooltipPopup>
      </Tooltip>
    </ProviderUsageMenuPopup>
  );
}
