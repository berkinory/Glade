import {
  ProviderManagementContext,
  ProviderListMcpServersResult,
  ProviderManageMcpServerInput,
  ProviderManagementResult,
  ProviderPluginInventoryResult,
  ProviderManagePluginInput,
} from "../../provider/providerManagement";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { WS_METHODS } from "./ws";
import {
  ProviderGetComposerCapabilitiesInput,
  ProviderComposerCapabilities,
  ProviderListCommandsInput,
  ProviderListCommandsResult,
  ProviderListSkillsInput,
  ProviderListSkillsResult,
  ProviderSkillsCatalogInput,
  ProviderSkillsCatalogResult,
  ProviderListPluginsInput,
  ProviderListPluginsResult,
  ProviderReadPluginInput,
  ProviderReadPluginResult,
  ProviderListModelsInput,
  ProviderListModelsResult,
  ProviderListAgentsInput,
  ProviderListAgentsResult,
} from "../../provider/providerDiscovery";
import { WsRpcError } from "./rpcErrors";

export const WsProviderGetComposerCapabilitiesRpc = Rpc.make(
  WS_METHODS.providerGetComposerCapabilities,
  {
    payload: ProviderGetComposerCapabilitiesInput,
    success: ProviderComposerCapabilities,
    error: WsRpcError,
  },
);

export const WsProviderListCommandsRpc = Rpc.make(WS_METHODS.providerListCommands, {
  payload: ProviderListCommandsInput,
  success: ProviderListCommandsResult,
  error: WsRpcError,
});

export const WsProviderListSkillsRpc = Rpc.make(WS_METHODS.providerListSkills, {
  payload: ProviderListSkillsInput,
  success: ProviderListSkillsResult,
  error: WsRpcError,
});

export const WsProviderListSkillsCatalogRpc = Rpc.make(WS_METHODS.providerListSkillsCatalog, {
  payload: ProviderSkillsCatalogInput,
  success: ProviderSkillsCatalogResult,
  error: WsRpcError,
});

export const WsProviderListPluginsRpc = Rpc.make(WS_METHODS.providerListPlugins, {
  payload: ProviderListPluginsInput,
  success: ProviderListPluginsResult,
  error: WsRpcError,
});

export const WsProviderReadPluginRpc = Rpc.make(WS_METHODS.providerReadPlugin, {
  payload: ProviderReadPluginInput,
  success: ProviderReadPluginResult,
  error: WsRpcError,
});

export const WsProviderListModelsRpc = Rpc.make(WS_METHODS.providerListModels, {
  payload: ProviderListModelsInput,
  success: ProviderListModelsResult,
  error: WsRpcError,
});

export const WsProviderListAgentsRpc = Rpc.make(WS_METHODS.providerListAgents, {
  payload: ProviderListAgentsInput,
  success: ProviderListAgentsResult,
  error: WsRpcError,
});

export const WsProviderListMcpServersRpc = Rpc.make(WS_METHODS.providerListMcpServers, {
  payload: ProviderManagementContext,
  success: ProviderListMcpServersResult,
  error: WsRpcError,
});

export const WsProviderManageMcpServerRpc = Rpc.make(WS_METHODS.providerManageMcpServer, {
  payload: ProviderManageMcpServerInput,
  success: ProviderManagementResult,
  error: WsRpcError,
});

export const WsProviderPluginInventoryRpc = Rpc.make(WS_METHODS.providerPluginInventory, {
  payload: ProviderManagementContext,
  success: ProviderPluginInventoryResult,
  error: WsRpcError,
});

export const WsProviderManagePluginRpc = Rpc.make(WS_METHODS.providerManagePlugin, {
  payload: ProviderManagePluginInput,
  success: ProviderManagementResult,
  error: WsRpcError,
});
