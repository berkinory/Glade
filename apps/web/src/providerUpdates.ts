import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type ServerProviderStatus } from "@glade/contracts/server/server";
import { type ServerSettings } from "@glade/contracts/settings/settings";

export const PROVIDER_UPDATE_INITIAL_REFRESH_DELAY_MS = 10_000;
export const PROVIDER_UPDATE_REFRESH_INTERVAL_MS = 60 * 60 * 1_000;

const PROVIDER_UPDATE_REQUEST_TIMEOUT_MS = 2 * 60_000 + 15_000;

function formatUpdateTimeout(timeoutMs: number): string {
  if (timeoutMs % 60_000 === 0) {
    const minutes = timeoutMs / 60_000;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const seconds = timeoutMs / 1_000;
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

export async function withProviderUpdateTimeout<T>(input: {
  readonly provider: ProviderKind;
  readonly request: Promise<T>;
  readonly timeoutMs?: number;
}): Promise<T> {
  const timeoutMs = input.timeoutMs ?? PROVIDER_UPDATE_REQUEST_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `${PROVIDER_DISPLAY_NAMES[input.provider]} update timed out after ${formatUpdateTimeout(timeoutMs)}.`,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([input.request, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

type ProviderUpdateFilterInput = {
  readonly providers: ReadonlyArray<ServerProviderStatus>;
  readonly hiddenProviders?: ReadonlyArray<ProviderKind>;
  readonly serverSettings?:
    | Pick<ServerSettings, "providers" | "enableProviderUpdateChecks">
    | null
    | undefined;
  readonly oneClickOnly?: boolean;
};

type ProviderUpdateVisibilityInput = {
  readonly provider: ServerProviderStatus;
  readonly hiddenProviders?: ReadonlyArray<ProviderKind>;
  readonly hiddenProviderSet?: ReadonlySet<ProviderKind>;
  readonly serverSettings?:
    | Pick<ServerSettings, "providers" | "enableProviderUpdateChecks">
    | null
    | undefined;
  readonly oneClickOnly?: boolean;
};

export function isProviderUpdateActive(provider: ServerProviderStatus): boolean {
  return provider.updateState?.status === "queued" || provider.updateState?.status === "running";
}

export function isProviderLatestVersionKnowable(provider: ServerProviderStatus): boolean {
  return provider.versionAdvisory?.latestVersionKnowable !== false;
}

export function shouldOfferProviderUpdateAction(provider: ServerProviderStatus): boolean {
  const advisory = provider.versionAdvisory;
  return (
    advisory?.canUpdate === true &&
    advisory.currentVersion !== null &&
    advisory.updateCommand !== null &&
    (advisory.status === "behind_latest" || advisory.status === "unknown")
  );
}

export function shouldPromptProviderUpdate(provider: ServerProviderStatus): boolean {
  return shouldOfferProviderUpdateAction(provider) && isProviderLatestVersionKnowable(provider);
}

function isProviderEnabled(
  provider: ProviderKind,
  serverSettings: Pick<ServerSettings, "providers"> | null | undefined,
): boolean {
  if (!serverSettings) {
    return false;
  }
  return serverSettings.providers[provider]?.enabled !== false;
}

export function shouldShowProviderUpdateStatus(input: ProviderUpdateVisibilityInput): boolean {
  const advisory = input.provider.versionAdvisory;
  const hiddenProviderSet = input.hiddenProviderSet ?? new Set(input.hiddenProviders ?? []);
  if (
    !advisory ||
    input.serverSettings?.enableProviderUpdateChecks === false ||
    advisory.status !== "behind_latest" ||
    advisory.latestVersion === null ||
    hiddenProviderSet.has(input.provider.provider) ||
    !isProviderEnabled(input.provider.provider, input.serverSettings)
  ) {
    return false;
  }

  return input.oneClickOnly === true
    ? advisory.canUpdate === true && advisory.updateCommand !== null
    : true;
}

function getVisibleProviderUpdateStatuses(
  input: ProviderUpdateFilterInput,
): ServerProviderStatus[] {
  const hiddenProviderSet = new Set(input.hiddenProviders ?? []);
  const oneClickOnly = input.oneClickOnly ?? false;

  return input.providers.filter((provider) =>
    shouldShowProviderUpdateStatus({
      provider,
      serverSettings: input.serverSettings,
      hiddenProviderSet,
      oneClickOnly,
    }),
  );
}

export function getNotifiableProviderUpdateStatuses(
  input: ProviderUpdateFilterInput & { readonly liveVersionCheckCompleted: boolean },
): ServerProviderStatus[] {
  if (!input.liveVersionCheckCompleted) {
    return [];
  }
  return getVisibleProviderUpdateStatuses({ ...input, oneClickOnly: true });
}

export function providerUpdateNotificationKey(
  providers: ReadonlyArray<ServerProviderStatus>,
): string | null {
  const parts = providers
    .map((provider) =>
      [provider.provider, provider.versionAdvisory?.latestVersion ?? "unknown"].join(":"),
    )
    .toSorted();

  return parts.length > 0 ? parts.join("|") : null;
}
