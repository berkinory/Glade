import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ServerProviderUsageSnapshot } from "@glade/contracts/server/server";
import { PROVIDER_DESCRIPTORS, PROVIDER_DESCRIPTOR_BY_KIND } from "./providerMetadata";

export const PROVIDER_USAGE_PROVIDERS: ReadonlyArray<ProviderKind> = PROVIDER_DESCRIPTORS.flatMap(
  (descriptor) => (descriptor.usage ? [descriptor.kind] : []),
);

function lookupMeta(provider: string | null | undefined) {
  if (!provider) {
    return undefined;
  }
  const descriptor = PROVIDER_DESCRIPTOR_BY_KIND[provider as ProviderKind];
  return descriptor?.usage ? descriptor : undefined;
}

export function providerUsageLabel(provider: string | null | undefined): string {
  const meta = lookupMeta(provider);
  return meta ? `${meta.displayName} usage` : "Usage";
}

export function providerUsageDisplayName(provider: string | null | undefined): string {
  return lookupMeta(provider)?.displayName ?? "Provider";
}

export function providerUsageLearnMoreHref(provider: string | null | undefined): string | null {
  return lookupMeta(provider)?.usage?.learnMoreHref ?? null;
}

// Detail sentence shown when usage can't be read because the credential is missing/expired.
export function providerUsageNeedsAuthDetail(provider: string | null | undefined): string {
  const meta = lookupMeta(provider);
  if (!meta) {
    return "Sign in with the provider CLI to see usage.";
  }
  return `Sign in with \`${meta.usage!.signInCommand}\` to see usage.`;
}

export function selectVisibleProviderUsageSnapshots(
  snapshots: ReadonlyArray<ServerProviderUsageSnapshot>,
): ReadonlyArray<ServerProviderUsageSnapshot> {
  const byProvider = new Map(snapshots.map((snapshot) => [snapshot.provider, snapshot]));
  const ordered = PROVIDER_USAGE_PROVIDERS.flatMap((provider) => {
    const snapshot = byProvider.get(provider);
    return snapshot ? [snapshot] : [];
  });
  const connected = ordered.filter((snapshot) => (snapshot.status ?? "ok") !== "needs-auth");
  return connected.length > 0 ? connected : ordered;
}
