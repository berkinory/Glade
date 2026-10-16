import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

// "Claude Code, Codex and Grok"
export function providerNames(providers: ReadonlyArray<ProviderKind>): string {
  return listFormat.format(providers.map((provider) => PROVIDER_DISPLAY_NAMES[provider]));
}
