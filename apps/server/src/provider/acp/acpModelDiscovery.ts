import type { NewSessionResponse, SessionConfigOption } from "@agentclientprotocol/sdk";
import type { ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";

import type { AcpConnection } from "./acpConnection.ts";
import { acpModelCatalog, acpModelOption, acpModelSlugs } from "./acpModelCatalog.ts";
import type { AcpProviderProfile } from "./acpProviderProfile.ts";

// Local agents answer a model switch in milliseconds; agents that resolve models remotely can take
// seconds each, and the models left unprobed are listed without settings.
const PROBE_BUDGET_MS = 3_000;

// Selects each model in the discovery session to read the settings it offers.
export async function discoverAcpModels(input: {
  readonly profile: AcpProviderProfile;
  readonly connection: AcpConnection;
  readonly session: NewSessionResponse;
  readonly signal: AbortSignal;
}): Promise<ReadonlyArray<ProviderModelDescriptor>> {
  const options = input.session.configOptions ?? [];
  const modelOption = acpModelOption(options);
  const optionsByModel = new Map<string, ReadonlyArray<SessionConfigOption>>();
  if (modelOption && !input.profile.savesModelChoiceGlobally) {
    optionsByModel.set(modelOption.currentValue, options);
    const deadline = performance.now() + PROBE_BUDGET_MS;
    for (const slug of acpModelSlugs(options)) {
      if (optionsByModel.has(slug)) continue;
      if (performance.now() > deadline || input.signal.aborted) break;
      const response = await input.connection.agent.setSessionConfigOption({
        sessionId: input.session.sessionId,
        configId: modelOption.id,
        value: slug,
      });
      optionsByModel.set(slug, response.configOptions);
    }
  }
  return acpModelCatalog(options, optionsByModel);
}
