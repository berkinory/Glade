import { ServiceMap, type Effect } from "effect";
import type {
  ProviderManagementContext,
  ProviderListMcpServersResult,
  ProviderManageMcpServerInput,
  ProviderManagementResult,
  ProviderPluginInventoryResult,
  ProviderManagePluginInput,
} from "@glade/contracts/provider/providerManagement";
import type { ProviderDiscoveryError } from "./ProviderDiscoveryService.ts";

export interface ProviderManagementShape {
  readonly listMcpServers: (
    input: ProviderManagementContext,
  ) => Effect.Effect<ProviderListMcpServersResult, ProviderDiscoveryError>;
  readonly manageMcpServer: (
    input: ProviderManageMcpServerInput,
  ) => Effect.Effect<ProviderManagementResult, ProviderDiscoveryError>;
  readonly pluginInventory: (
    input: ProviderManagementContext,
  ) => Effect.Effect<ProviderPluginInventoryResult, ProviderDiscoveryError>;
  readonly managePlugin: (
    input: ProviderManagePluginInput,
  ) => Effect.Effect<ProviderManagementResult, ProviderDiscoveryError>;
}

export class ProviderManagement extends ServiceMap.Service<
  ProviderManagement,
  ProviderManagementShape
>()("glade/provider/Services/ProviderManagement") {}
