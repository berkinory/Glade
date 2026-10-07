import { VisualReplyPreviewLive } from "./visualReplies/Layers/VisualReplyPreview";
import { HandoffTransitionsLive } from "./orchestration/Layers/HandoffTransitions";
import { ThreadTitleGenerationLive } from "./orchestration/Layers/ThreadTitleGeneration";
import { AppPresentationLive } from "./agentGateway/Layers/AppPresentation";
import { AgentGatewayDiscoveryLive } from "./agentGateway/Layers/AgentGatewayDiscovery";
import { HandoffPreparationLive } from "./orchestration/Layers/HandoffPreparation";
import { HandoffGenerationLive } from "./provider/Layers/HandoffGeneration";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer } from "effect";

import { AgentGatewayLive } from "./agentGateway/Layers/AgentGateway";
import { BrowserHostLive } from "./browser/Layers/BrowserHost";
import { DesktopHostClientLive } from "./desktopHost/Layers/DesktopHostClient";
import { ComputerAccessLive } from "./computer/Layers/ComputerAccess";
import { ComputerHostLive } from "./computer/Layers/ComputerHost";
import { AgentGatewayOperationRepositoryLive } from "./agentGateway/Layers/AgentGatewayOperationRepository";
import { AgentGatewayCredentialsWithSecretsLive } from "./agentGateway/Layers/AgentGatewayCredentials";
import { CheckpointDiffQueryLive } from "./checkpointing/Layers/CheckpointDiffQuery";
import { CheckpointStoreLive } from "./checkpointing/Layers/CheckpointStore";
import { CheckpointReactorLive } from "./orchestration/Layers/CheckpointReactor";
import { OrchestrationReactorLive } from "./orchestration/Layers/OrchestrationReactor";
import { ThreadGitMetadataReactorLive } from "./orchestration/Layers/ThreadGitMetadataReactor";
import { ProviderCommandReactorLive } from "./orchestration/Layers/ProviderCommandReactor";
import { ProviderRuntimeIngestionLive } from "./orchestration/Layers/ProviderRuntimeIngestion";
import { RuntimeReceiptBusLive } from "./orchestration/Layers/RuntimeReceiptBus";
import { ThreadDeletionReactorLive } from "./orchestration/Layers/ThreadDeletionReactor";
import { TurnCheckpointCoordinatorLive } from "./orchestration/Layers/TurnCheckpointCoordinator";
import { OrchestrationLayerLive } from "./orchestration/runtimeLayer";
import { KeybindingsLive } from "./settings/Layers/Keybindings";
import { GitCoreLive } from "./git/Layers/GitCore";
import { GitLayerLive, TextGenerationLayerLive } from "./git/runtimeLayer";
import { GitActionRunsLive } from "./git/Layers/GitActionRuns";
import { TerminalLayerLive } from "./terminal/runtimeLayer";
import { AuthControlPlaneLive } from "./auth/Layers/AuthControlPlane";
import { BootstrapCredentialServiceLive } from "./auth/Layers/BootstrapCredentialService";
import { ServerAuthLive } from "./auth/Layers/ServerAuth";
import { ServerAuthPolicyLive } from "./auth/Layers/ServerAuthPolicy";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore";
import { SessionCredentialServiceLive } from "./auth/Layers/SessionCredentialService";
import { ProfileStatsQueryLive } from "./diagnostics/Layers/ProfileStatsQuery";
import { ProfileStatsArchiveLive } from "./diagnostics/profileStatsArchive";
import { ServerLifecycleEventsLive } from "./server/lifecycle/serverLifecycleEvents";
import { ServerRuntimeStartupLive } from "./server/runtime/serverRuntimeStartup";
import { ServerSettingsLive } from "./settings/serverSettings";
import { WorkspaceLayerLive } from "./workspace/runtimeLayer";
import { ProjectFaviconResolverLive } from "./project/Layers/ProjectFaviconResolver";
import { ServerEnvironmentLive } from "./environment/Layers/ServerEnvironment";
import { ProjectionTurnRepositoryLive } from "./persistence/Layers/ProjectionTurns";
import { OrchestrationEventDeliveryRepositoryLive } from "./persistence/Layers/OrchestrationEventDeliveries";
import { ProviderRuntimeEventRepositoryLive } from "./persistence/Layers/ProviderRuntimeEvents";
import { ThreadDiagnosticsQueryLive } from "./diagnostics/Layers/ThreadDiagnosticsQuery";
import { ManagedAttachmentCleanupLive } from "./attachments/managedAttachmentCleanup";
import { ProviderHealthLive } from "./provider/Layers/ProviderHealth";
import { makeServerProviderLayer } from "./provider/core/runtimeLayer";

function makeServerRuntimeServicesLayer(
  options: {
    readonly agentGatewayCredentialsLayer?: typeof AgentGatewayCredentialsWithSecretsLive;
  } = {},
) {
  const agentGatewayCredentialsLayer =
    options.agentGatewayCredentialsLayer ?? AgentGatewayCredentialsWithSecretsLive;
  const providerHealthLayer = ProviderHealthLive.pipe(Layer.provideMerge(ServerSettingsLive));
  const checkpointStoreLayer = CheckpointStoreLive.pipe(Layer.provide(GitCoreLive));

  const checkpointDiffQueryLayer = CheckpointDiffQueryLive.pipe(
    Layer.provideMerge(OrchestrationLayerLive),
    Layer.provideMerge(checkpointStoreLayer),
  );

  const runtimeServicesLayer = Layer.mergeAll(
    checkpointDiffQueryLayer,
    RuntimeReceiptBusLive,
    TurnCheckpointCoordinatorLive,
  );
  const managedAttachmentCleanupLayer = ManagedAttachmentCleanupLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const runtimeIngestionLayer = ProviderRuntimeIngestionLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const threadGitMetadataReactorLayer = ThreadGitMetadataReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(GitLayerLive),
  );
  const handoffPreparationLayer = HandoffPreparationLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(HandoffGenerationLive),
    Layer.provideMerge(HandoffTransitionsLive.pipe(Layer.provideMerge(runtimeServicesLayer))),
    Layer.provideMerge(ServerSettingsLive),
  );
  const providerCommandReactorLayer = ProviderCommandReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(providerHealthLayer),
    Layer.provideMerge(OrchestrationEventDeliveryRepositoryLive),
    Layer.provideMerge(GitCoreLive),
    Layer.provideMerge(ThreadTitleGenerationLive),
    Layer.provideMerge(TextGenerationLayerLive),
    Layer.provideMerge(handoffPreparationLayer),
    Layer.provideMerge(ServerSettingsLive),
    Layer.provideMerge(AgentGatewayOperationRepositoryLive),
  );
  const checkpointReactorLayer = CheckpointReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const profileStatsArchiveLayer = ProfileStatsArchiveLive.pipe(
    Layer.provideMerge(checkpointStoreLayer),
  );
  const orchestrationReactorLayer = OrchestrationReactorLive.pipe(
    Layer.provideMerge(runtimeIngestionLayer),
    Layer.provideMerge(providerCommandReactorLayer),
    Layer.provideMerge(checkpointReactorLayer),
    Layer.provideMerge(threadGitMetadataReactorLayer),
  );
  const threadDeletionReactorLayer = ThreadDeletionReactorLive.pipe(
    Layer.provideMerge(profileStatsArchiveLayer),
    Layer.provideMerge(OrchestrationLayerLive),
    Layer.provideMerge(TerminalLayerLive),
    Layer.provideMerge(GitCoreLive),
  );

  const sessionCredentialLayer = SessionCredentialServiceLive.pipe(
    Layer.provide(ServerSecretStoreLive),
  );
  const authControlPlaneLayer = AuthControlPlaneLive.pipe(
    Layer.provide(BootstrapCredentialServiceLive),
    Layer.provide(sessionCredentialLayer),
  );
  const serverAuthLayer = ServerAuthLive.pipe(
    Layer.provide(ServerAuthPolicyLive),
    Layer.provide(BootstrapCredentialServiceLive),
    Layer.provide(sessionCredentialLayer),
    Layer.provide(authControlPlaneLayer),
  );
  const authServicesLayer = Layer.mergeAll(
    ServerAuthPolicyLive,
    ServerSecretStoreLive,
    BootstrapCredentialServiceLive,
    sessionCredentialLayer,
    authControlPlaneLayer,
    serverAuthLayer,
  );
  const gitActionRunsLayer = GitActionRunsLive.pipe(
    Layer.provide(Layer.mergeAll(GitLayerLive, sessionCredentialLayer)),
  );
  const desktopHostLayers = Layer.mergeAll(
    BrowserHostLive,
    ComputerAccessLive.pipe(Layer.provideMerge(ComputerHostLive)),
  ).pipe(Layer.provideMerge(DesktopHostClientLive), Layer.provideMerge(runtimeServicesLayer));
  const agentGatewayLayer = AgentGatewayLive.pipe(
    Layer.provideMerge(desktopHostLayers),
    Layer.provideMerge(VisualReplyPreviewLive),
    Layer.provideMerge(AppPresentationLive),
    Layer.provideMerge(agentGatewayCredentialsLayer),
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(AgentGatewayDiscoveryLive.pipe(Layer.provide(runtimeServicesLayer))),
    Layer.provideMerge(GitLayerLive),
    Layer.provideMerge(ProjectionTurnRepositoryLive),
    Layer.provideMerge(AgentGatewayOperationRepositoryLive),
    Layer.provideMerge(OrchestrationEventDeliveryRepositoryLive),
    Layer.provideMerge(ProviderRuntimeEventRepositoryLive),
    Layer.provideMerge(ThreadDiagnosticsQueryLive),
    Layer.provideMerge(ServerSettingsLive),
    Layer.provideMerge(providerHealthLayer),
  );

  return Layer.mergeAll(
    agentGatewayCredentialsLayer,
    agentGatewayLayer,
    managedAttachmentCleanupLayer,
    AgentGatewayOperationRepositoryLive,
    providerHealthLayer,
    handoffPreparationLayer,
    orchestrationReactorLayer,
    providerCommandReactorLayer,
    threadGitMetadataReactorLayer,
    threadDeletionReactorLayer,
    GitLayerLive,
    gitActionRunsLayer,
    TextGenerationLayerLive,
    TerminalLayerLive,
    KeybindingsLive,
    ServerSettingsLive,
    ServerEnvironmentLive,
    ProfileStatsQueryLive,
    authServicesLayer,
    ServerLifecycleEventsLive,
    ServerRuntimeStartupLive,
    WorkspaceLayerLive,
    ProjectFaviconResolverLive,
  ).pipe(Layer.provideMerge(NodeServices.layer));
}

export function makeServerApplicationLayers() {
  const agentGatewayCredentialsLayer = AgentGatewayCredentialsWithSecretsLive;
  const runtimeServicesLayer = makeServerRuntimeServicesLayer({
    agentGatewayCredentialsLayer,
  });

  const providerLayer = makeServerProviderLayer({ agentGatewayCredentialsLayer }).pipe(
    Layer.provideMerge(ServerSettingsLive),
  );
  return {
    runtimeServicesLayer,
    providerLayer,
  } as const;
}
