import type { ProviderKind } from "@glade/contracts/core/baseSchemas";

export function resolveThreadDisplayProvider(thread: {
  readonly session?: { readonly provider: ProviderKind } | null;
  readonly modelSelection: { readonly provider: ProviderKind };
}): ProviderKind {
  return thread.session?.provider ?? thread.modelSelection.provider;
}
