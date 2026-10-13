import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import {
  PROVIDER_DESCRIPTORS,
  type ProviderDescriptor,
} from "@glade/shared/provider/providerMetadata";

import { claudeUsageFetcher } from "./providers/claude";
import { codexUsageFetcher } from "./providers/codex";
import { makeOpenUsageFetcher } from "./providers/openUsage";
import type { ProviderUsageFetcher } from "./types";

const NATIVE_USAGE_FETCHERS: Partial<Record<ProviderKind, ProviderUsageFetcher>> = {
  codex: codexUsageFetcher,
  claudeAgent: claudeUsageFetcher,
};

// A provider's own usage reader wins; the others read OpenUsage when it tracks them.
export const PROVIDER_USAGE_FETCHERS: Partial<Record<ProviderKind, ProviderUsageFetcher>> =
  Object.fromEntries(
    PROVIDER_DESCRIPTORS.flatMap((descriptor: ProviderDescriptor) => {
      const fetcher =
        NATIVE_USAGE_FETCHERS[descriptor.kind] ??
        (descriptor.usage?.openUsageId
          ? makeOpenUsageFetcher({
              provider: descriptor.kind,
              displayName: descriptor.displayName,
              openUsageId: descriptor.usage.openUsageId,
            })
          : undefined);
      return fetcher ? [[descriptor.kind, fetcher] as const] : [];
    }),
  );
