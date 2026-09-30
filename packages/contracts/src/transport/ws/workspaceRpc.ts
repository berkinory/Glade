import * as Rpc from "effect/unstable/rpc/Rpc";
import { WS_METHODS } from "./ws";
import {
  ProjectListDirectoriesInput,
  ProjectListDirectoriesResult,
  ProjectDiscoverScriptsInput,
  ProjectDiscoverScriptsResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectSearchLocalEntriesInput,
  ProjectSearchLocalEntriesResult,
  ProjectSearchContentInput,
  ProjectSearchContentResult,
  ProjectPrewarmSearchIndexInput,
  ProjectPrewarmSearchIndexResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWatchFileInput,
  ProjectFileChangeEvent,
  ProjectResolveWorkspaceFileReferencesInput,
  ProjectResolveWorkspaceFileReferencesResult,
  ProjectResolveOutOfRootFileReferenceInput,
  ProjectResolveOutOfRootFileReferenceResult,
  ProjectCreateLocalFilePreviewGrantInput,
  ProjectCreateLocalFilePreviewGrantResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
  ProjectManageEntryInput,
  ProjectManageEntryResult,
  ProjectRunDevServerInput,
  ProjectRunDevServerResult,
  ProjectStopDevServerInput,
  ProjectStopDevServerResult,
  ProjectListDevServersResult,
  ProjectDevServerEvent,
} from "../../workspace/project";
import { Schema } from "effect";
import {
  GitHubProjectProvisionInput,
  GitHubProjectProvisionProgressEvent,
} from "../../git/githubProjectProvisioning";
import { FilesystemBrowseInput, FilesystemBrowseResult } from "../../workspace/filesystem";
import { OpenInEditorInput } from "../../settings/editor";
import { WsRpcError } from "./rpcErrors";

export const WsProjectsListDirectoriesRpc = Rpc.make(WS_METHODS.projectsListDirectories, {
  payload: ProjectListDirectoriesInput,
  success: ProjectListDirectoriesResult,
  error: WsRpcError,
});

export const WsProjectsDiscoverScriptsRpc = Rpc.make(WS_METHODS.projectsDiscoverScripts, {
  payload: ProjectDiscoverScriptsInput,
  success: ProjectDiscoverScriptsResult,
  error: WsRpcError,
});

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: WsRpcError,
});

export const WsProjectsSearchLocalEntriesRpc = Rpc.make(WS_METHODS.projectsSearchLocalEntries, {
  payload: ProjectSearchLocalEntriesInput,
  success: ProjectSearchLocalEntriesResult,
  error: WsRpcError,
});

export const WsProjectsSearchContentRpc = Rpc.make(WS_METHODS.projectsSearchContent, {
  payload: ProjectSearchContentInput,
  success: ProjectSearchContentResult,
  error: WsRpcError,
});

export const WsProjectsPrewarmSearchIndexRpc = Rpc.make(WS_METHODS.projectsPrewarmSearchIndex, {
  payload: ProjectPrewarmSearchIndexInput,
  success: ProjectPrewarmSearchIndexResult,
  error: WsRpcError,
});

export const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: WsRpcError,
});

export const WsProjectsSubscribeFileChangeRpc = Rpc.make(WS_METHODS.projectsSubscribeFileChange, {
  payload: ProjectWatchFileInput,
  success: ProjectFileChangeEvent,
  error: WsRpcError,
  stream: true,
});

export const WsProjectsResolveWorkspaceFileReferencesRpc = Rpc.make(
  WS_METHODS.projectsResolveWorkspaceFileReferences,
  {
    payload: ProjectResolveWorkspaceFileReferencesInput,
    success: ProjectResolveWorkspaceFileReferencesResult,
    error: WsRpcError,
  },
);

export const WsProjectsResolveOutOfRootFileReferenceRpc = Rpc.make(
  WS_METHODS.projectsResolveOutOfRootFileReference,
  {
    payload: ProjectResolveOutOfRootFileReferenceInput,
    success: ProjectResolveOutOfRootFileReferenceResult,
    error: WsRpcError,
  },
);

export const WsProjectsCreateLocalFilePreviewGrantRpc = Rpc.make(
  WS_METHODS.projectsCreateLocalFilePreviewGrant,
  {
    payload: ProjectCreateLocalFilePreviewGrantInput,
    success: ProjectCreateLocalFilePreviewGrantResult,
    error: WsRpcError,
  },
);

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: WsRpcError,
});

export const WsProjectsManageEntryRpc = Rpc.make(WS_METHODS.projectsManageEntry, {
  payload: ProjectManageEntryInput,
  success: ProjectManageEntryResult,
  error: WsRpcError,
});

export const WsProjectsRunDevServerRpc = Rpc.make(WS_METHODS.projectsRunDevServer, {
  payload: ProjectRunDevServerInput,
  success: ProjectRunDevServerResult,
  error: WsRpcError,
});

export const WsProjectsStopDevServerRpc = Rpc.make(WS_METHODS.projectsStopDevServer, {
  payload: ProjectStopDevServerInput,
  success: ProjectStopDevServerResult,
  error: WsRpcError,
});

export const WsProjectsListDevServersRpc = Rpc.make(WS_METHODS.projectsListDevServers, {
  payload: Schema.Struct({}),
  success: ProjectListDevServersResult,
  error: WsRpcError,
});

export const WsSubscribeProjectDevServerEventsRpc = Rpc.make(
  WS_METHODS.subscribeProjectDevServerEvents,
  {
    payload: Schema.Struct({}),
    success: ProjectDevServerEvent,
    error: WsRpcError,
    stream: true,
  },
);

export const WsProjectsProvisionFromGitHubRpc = Rpc.make(WS_METHODS.projectsProvisionFromGitHub, {
  payload: GitHubProjectProvisionInput,
  success: GitHubProjectProvisionProgressEvent,
  error: WsRpcError,
  stream: true,
});

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: WsRpcError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  success: Schema.Void,
  error: WsRpcError,
});
