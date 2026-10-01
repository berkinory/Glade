import type { ModelSlug } from "@glade/contracts/provider/model";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { resolveSelectableModel } from "@glade/shared/provider/model";
import { type ProviderPickerKind, PROVIDER_OPTIONS } from "../../session-logic";
import {
  formatProviderModelOptionName,
  type ProviderModelOption,
} from "../../providerModelOptions";
import { compareProvidersByOrder } from "../../providerOrdering";

function isAvailableProviderOption(option: (typeof PROVIDER_OPTIONS)[number]): option is {
  value: ProviderKind;
  label: string;
  available: true;
} {
  return option.available;
}

export function resolveLiveProviderAvailability(provider: ServerProviderStatus | undefined): {
  disabled: boolean;
  label: string | null;
} {
  if (!provider) {
    return {
      disabled: true,
      label: "Checking",
    };
  }

  if (!provider.available) {
    return {
      disabled: true,
      label: provider.authStatus === "unauthenticated" ? "Sign in" : "Unavailable",
    };
  }

  if (provider.authStatus === "unauthenticated") {
    return {
      disabled: true,
      label: "Sign in",
    };
  }

  return {
    disabled: false,
    label: null,
  };
}

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption);

function filterProviderOptionsByVisibility<T extends { value: ProviderKind }>(
  options: ReadonlyArray<T>,
  hiddenProviders: ReadonlySet<ProviderKind>,
  protectedProviders: ReadonlySet<ProviderKind>,
): ReadonlyArray<T> {
  if (hiddenProviders.size === 0) {
    return options;
  }
  return options.filter(
    (option) => protectedProviders.has(option.value) || !hiddenProviders.has(option.value),
  );
}

export function resolveVisibleProviderOptions(input: {
  provider: ProviderKind;
  lockedProvider: ProviderKind | null;
  providers: ReadonlyArray<ServerProviderStatus> | undefined;
  hiddenProviders: ReadonlyArray<ProviderKind> | undefined;
  providerOrder: ReadonlyArray<ProviderKind> | undefined;
}) {
  const protectedProviderSet = new Set<ProviderKind>([input.provider]);
  if (input.lockedProvider !== null) {
    protectedProviderSet.add(input.lockedProvider);
  }
  return filterProviderOptionsByVisibility(
    AVAILABLE_PROVIDER_OPTIONS.toSorted((left, right) =>
      compareProvidersByOrder(input.providerOrder ?? [], left.value, right.value),
    ).filter((option) =>
      input.providers?.some((provider) => provider.provider === option.value && provider.available),
    ),
    new Set<ProviderKind>(input.hiddenProviders ?? []),
    protectedProviderSet,
  );
}

function providerIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string,
): string {
  return provider === "claudeAgent" ? "text-foreground" : fallbackClassName;
}

function resolveSelectedModelLabel(input: {
  provider: ProviderKind;
  model: string;
  options: ReadonlyArray<ProviderModelOption>;
}): string {
  const resolvedSlug = resolveSelectableModel(input.provider, input.model, input.options);
  if (resolvedSlug) {
    const resolvedOption = input.options.find((option) => option.slug === resolvedSlug);
    if (resolvedOption) {
      return resolvedOption.name;
    }
  }
  return formatProviderModelOptionName({
    provider: input.provider,
    slug: input.model,
  });
}

export function resolveProviderModelLabel(input: {
  provider: ProviderKind;
  lockedProvider: ProviderKind | null;
  model: ModelSlug;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
}): string {
  const activeProvider = input.lockedProvider ?? input.provider;
  return resolveSelectedModelLabel({
    provider: activeProvider,
    model: input.model,
    options: input.modelOptionsByProvider[activeProvider],
  });
}

export function getProviderIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string = "text-muted-foreground/70",
): string {
  return providerIconClassName(provider, fallbackClassName);
}
