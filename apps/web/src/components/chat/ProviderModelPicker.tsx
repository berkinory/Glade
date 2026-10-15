import type { ModelSlug } from "@glade/contracts/provider/model";
import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { resolveSelectableModel } from "@glade/shared/provider/model";
import { type ProviderPickerKind, PROVIDER_OPTIONS } from "../../session-logic";
import {
  formatProviderModelOptionName,
  formatProviderScopedModelName,
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

export function resolveVisibleProviderOptions(input: {
  provider: ProviderKind;
  lockedProvider: ProviderKind | null;
  providers: ReadonlyArray<ServerProviderStatus> | undefined;
  providerOrder: ReadonlyArray<ProviderKind> | undefined;
}) {
  return AVAILABLE_PROVIDER_OPTIONS.toSorted((left, right) =>
    compareProvidersByOrder(input.providerOrder ?? [], left.value, right.value),
  ).filter((option) =>
    input.providers?.some((provider) => provider.provider === option.value && provider.available),
  );
}

function providerIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string,
): string {
  return provider === "claudeAgent" ? "text-foreground" : fallbackClassName;
}

function resolveSelectedModelName(input: {
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
  return formatProviderModelOptionName(input.model);
}

// `displayName` is for beside the provider icon; `name` is for assistive tech and tooltips.
export interface ProviderModelLabel {
  name: string;
  displayName: string;
}

export function resolveProviderModelLabel(input: {
  provider: ProviderKind;
  lockedProvider: ProviderKind | null;
  model: ModelSlug;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
}): ProviderModelLabel {
  const activeProvider = input.lockedProvider ?? input.provider;
  const options = input.modelOptionsByProvider[activeProvider];
  const name = resolveSelectedModelName({ provider: activeProvider, model: input.model, options });
  return {
    name,
    displayName: formatProviderScopedModelName(
      activeProvider,
      name,
      options.map((option) => option.name),
    ),
  };
}

export function getProviderIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string = "text-muted-foreground/70",
): string {
  return providerIconClassName(provider, fallbackClassName);
}
