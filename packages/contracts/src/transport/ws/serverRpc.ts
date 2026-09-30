import * as Rpc from "effect/unstable/rpc/Rpc";
import { WS_METHODS } from "./ws";
import { Schema } from "effect";
import {
  ServerConfig,
  ServerGetEnvironmentResult,
  ServerGetSettingsResult,
  ServerUpdateSettingsInput,
  ServerUpdateSettingsResult,
  ServerRefreshProvidersResult,
  ServerProviderUpdateInput,
  ServerProviderUpdateResult,
  ServerProviderUpdateError,
  ServerListWorktreesResult,
  ServerListLocalServersResult,
  ServerStopLocalServerInput,
  ServerStopLocalServerResult,
  ServerGetProviderUsageSnapshotInput,
  ServerGetProviderUsageSnapshotResult,
  ServerListProviderUsageInput,
  ServerListProviderUsageResult,
  ServerConsumeCodexResetCreditInput,
  ServerConsumeCodexResetCreditResult,
  ServerDiagnosticsResult,
  ServerReadThreadDiagnosticsInput,
  ServerReadThreadDiagnosticsResult,
  ServerVoicePrewarmInput,
  ServerVoicePrewarmResult,
  ServerVoiceTranscriptionInput,
  ServerVoiceTranscriptionResult,
  ServerGenerateAutomationIntentInput,
  ServerGenerateAutomationIntentResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
  ServerLifecycleStreamEvent,
  ServerConfigStreamEvent,
} from "../../server/server";
import {
  StatsGetProfileStatsInput,
  StatsGetProfileStatsResult,
  StatsGetProfileTokenStatsInput,
  StatsGetProfileTokenStatsResult,
} from "../../server/stats";
import { WsRpcError } from "./rpcErrors";

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: WsRpcError,
});

export const WsServerGetEnvironmentRpc = Rpc.make(WS_METHODS.serverGetEnvironment, {
  payload: Schema.Struct({}),
  success: ServerGetEnvironmentResult,
  error: WsRpcError,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerGetSettingsResult,
  error: WsRpcError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: ServerUpdateSettingsInput,
  success: ServerUpdateSettingsResult,
  error: WsRpcError,
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({}),
  success: ServerRefreshProvidersResult,
  error: WsRpcError,
});

export const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdateResult,
  error: ServerProviderUpdateError,
});

export const WsServerListWorktreesRpc = Rpc.make(WS_METHODS.serverListWorktrees, {
  payload: Schema.Struct({}),
  success: ServerListWorktreesResult,
  error: WsRpcError,
});

export const WsServerListLocalServersRpc = Rpc.make(WS_METHODS.serverListLocalServers, {
  payload: Schema.Struct({}),
  success: ServerListLocalServersResult,
  error: WsRpcError,
});

export const WsServerStopLocalServerRpc = Rpc.make(WS_METHODS.serverStopLocalServer, {
  payload: ServerStopLocalServerInput,
  success: ServerStopLocalServerResult,
  error: WsRpcError,
});

export const WsServerGetProviderUsageSnapshotRpc = Rpc.make(
  WS_METHODS.serverGetProviderUsageSnapshot,
  {
    payload: ServerGetProviderUsageSnapshotInput,
    success: ServerGetProviderUsageSnapshotResult,
    error: WsRpcError,
  },
);

export const WsServerListProviderUsageRpc = Rpc.make(WS_METHODS.serverListProviderUsage, {
  payload: ServerListProviderUsageInput,
  success: ServerListProviderUsageResult,
  error: WsRpcError,
});

export const WsServerConsumeCodexResetCreditRpc = Rpc.make(
  WS_METHODS.serverConsumeCodexResetCredit,
  {
    payload: ServerConsumeCodexResetCreditInput,
    success: ServerConsumeCodexResetCreditResult,
    error: WsRpcError,
  },
);

export const WsStatsGetProfileStatsRpc = Rpc.make(WS_METHODS.statsGetProfileStats, {
  payload: StatsGetProfileStatsInput,
  success: StatsGetProfileStatsResult,
  error: WsRpcError,
});

export const WsStatsGetProfileTokenStatsRpc = Rpc.make(WS_METHODS.statsGetProfileTokenStats, {
  payload: StatsGetProfileTokenStatsInput,
  success: StatsGetProfileTokenStatsResult,
  error: WsRpcError,
});

export const WsServerGetDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerDiagnosticsResult,
  error: WsRpcError,
});

export const WsServerReadThreadDiagnosticsRpc = Rpc.make(WS_METHODS.serverReadThreadDiagnostics, {
  payload: ServerReadThreadDiagnosticsInput,
  success: ServerReadThreadDiagnosticsResult,
  error: WsRpcError,
});

export const WsServerPrewarmVoiceRpc = Rpc.make(WS_METHODS.serverPrewarmVoice, {
  payload: ServerVoicePrewarmInput,
  success: ServerVoicePrewarmResult,
  error: WsRpcError,
});

export const WsServerTranscribeVoiceRpc = Rpc.make(WS_METHODS.serverTranscribeVoice, {
  payload: ServerVoiceTranscriptionInput,
  success: ServerVoiceTranscriptionResult,
  error: WsRpcError,
});

export const WsServerGenerateAutomationIntentRpc = Rpc.make(
  WS_METHODS.serverGenerateAutomationIntent,
  {
    payload: ServerGenerateAutomationIntentInput,
    success: ServerGenerateAutomationIntentResult,
    error: WsRpcError,
  },
);

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: WsRpcError,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  error: WsRpcError,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: WsRpcError,
  stream: true,
});

export const WsSubscribeServerProviderStatusesRpc = Rpc.make(
  WS_METHODS.subscribeServerProviderStatuses,
  {
    payload: Schema.Struct({}),
    success: ServerRefreshProvidersResult,
    error: WsRpcError,
    stream: true,
  },
);

export const WsSubscribeServerSettingsRpc = Rpc.make(WS_METHODS.subscribeServerSettings, {
  payload: Schema.Struct({}),
  success: Schema.Struct({ settings: ServerGetSettingsResult }),
  error: WsRpcError,
  stream: true,
});
