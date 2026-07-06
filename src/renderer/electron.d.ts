import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { WebviewTag } from 'electron';
import type {
  StartOrResumeSessionRequest,
  StartOrResumeSessionResponse,
  SendUserMessageRequest,
  StopSessionRequest,
  ListProjectsResponse,
  ListSessionsForProjectRequest,
  ListSessionsForProjectResponse,
  LoadHistoricalSessionRequest,
  LoadHistoricalSessionResponse,
  ClaudeSessionEvent,
  ListModelProvidersResponse,
  SaveModelProviderRequest,
  SaveModelProviderResponse,
  DeleteModelProviderRequest,
  DeleteModelProviderResponse,
  LoadPluginCatalogResponse,
  InstallPluginRequest,
  InstallPluginResponse,
  UninstallPluginRequest,
  UninstallPluginResponse,
  ListMcpServersResponse,
  GetClaudeVersionResponse,
  RunDoctorRequest,
  RunDoctorResponse,
  GetProjectSettingsRequest,
  GetProjectSettingsResponse,
  OpenClaudeMdRequest,
  OpenClaudeMdResponse,
  GetUsageStatsResponse,
  GetGitStatusRequest,
  GitStatusResponse,
  GetGitWorktreesRequest,
  GitWorktreesResponse,
  GetGitDiffRequest,
  GetGitDiffResponse,
  ListDirEntriesRequest,
  ListDirEntriesResponse,
  GetFilePreviewRequest,
  GetFilePreviewResponse,
  SetProjectPinnedRequest,
  SetProjectCollapsedRequest,
  RenameProjectRequest,
  RemoveProjectRequest,
  ArchiveSessionRequest,
  RemoveSessionRequest,
  ShowInFinderRequest,
  ShowInFinderResponse,
  CreateWorktreeRequest,
  CreateWorktreeResponse,
  ForkSessionRequest,
  ForkSessionResponse,
  GetEnvConfigResponse,
  GetAuthStatusResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
  WriteTerminalRequest,
  ResizeTerminalRequest,
  DisposeTerminalRequest,
  TerminalEvent,
} from '../shared/ipc';

export interface ElectronAPI {
  platform: string;
  claude: {
    startOrResumeSession: (req: StartOrResumeSessionRequest) => Promise<StartOrResumeSessionResponse>;
    sendUserMessage: (req: SendUserMessageRequest) => Promise<void>;
    stopSession: (req: StopSessionRequest) => Promise<void>;
    listProjects: () => Promise<ListProjectsResponse>;
    listSessionsForProject: (req: ListSessionsForProjectRequest) => Promise<ListSessionsForProjectResponse>;
    loadHistoricalSession: (req: LoadHistoricalSessionRequest) => Promise<LoadHistoricalSessionResponse>;
    listModelProviders: () => Promise<ListModelProvidersResponse>;
    saveModelProvider: (req: SaveModelProviderRequest) => Promise<SaveModelProviderResponse>;
    deleteModelProvider: (req: DeleteModelProviderRequest) => Promise<DeleteModelProviderResponse>;
    loadPluginCatalog: () => Promise<LoadPluginCatalogResponse>;
    installPlugin: (req: InstallPluginRequest) => Promise<InstallPluginResponse>;
    uninstallPlugin: (req: UninstallPluginRequest) => Promise<UninstallPluginResponse>;
    listMcpServers: () => Promise<ListMcpServersResponse>;
    getClaudeVersion: () => Promise<GetClaudeVersionResponse>;
    runDoctor: (req: RunDoctorRequest) => Promise<RunDoctorResponse>;
    getProjectSettings: (req: GetProjectSettingsRequest) => Promise<GetProjectSettingsResponse>;
    openClaudeMd: (req: OpenClaudeMdRequest) => Promise<OpenClaudeMdResponse>;
    getUsageStats: () => Promise<GetUsageStatsResponse>;
    getGitStatus: (req: GetGitStatusRequest) => Promise<GitStatusResponse>;
    getGitWorktrees: (req: GetGitWorktreesRequest) => Promise<GitWorktreesResponse>;
    getGitDiff: (req: GetGitDiffRequest) => Promise<GetGitDiffResponse>;
    listDirEntries: (req: ListDirEntriesRequest) => Promise<ListDirEntriesResponse>;
    getFilePreview: (req: GetFilePreviewRequest) => Promise<GetFilePreviewResponse>;
    setProjectPinned: (req: SetProjectPinnedRequest) => Promise<void>;
    setProjectCollapsed: (req: SetProjectCollapsedRequest) => Promise<void>;
    renameProject: (req: RenameProjectRequest) => Promise<void>;
    removeProject: (req: RemoveProjectRequest) => Promise<void>;
    archiveSession: (req: ArchiveSessionRequest) => Promise<void>;
    removeSession: (req: RemoveSessionRequest) => Promise<void>;
    showInFinder: (req: ShowInFinderRequest) => Promise<ShowInFinderResponse>;
    createWorktree: (req: CreateWorktreeRequest) => Promise<CreateWorktreeResponse>;
    forkSession: (req: ForkSessionRequest) => Promise<ForkSessionResponse>;
    getEnvConfig: () => Promise<GetEnvConfigResponse>;
    getAuthStatus: () => Promise<GetAuthStatusResponse>;
    onSessionEvent: (cb: (event: ClaudeSessionEvent) => void) => () => void;
    createTerminal: (req: CreateTerminalRequest) => Promise<CreateTerminalResponse>;
    writeTerminal: (req: WriteTerminalRequest) => Promise<void>;
    resizeTerminal: (req: ResizeTerminalRequest) => Promise<void>;
    disposeTerminal: (req: DisposeTerminalRequest) => Promise<void>;
    onTerminalEvent: (cb: (event: TerminalEvent) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<WebviewTag>, WebviewTag> & { src?: string };
    }
  }
}
