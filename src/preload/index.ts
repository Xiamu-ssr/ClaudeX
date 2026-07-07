import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type StartOrResumeSessionRequest,
  type StartOrResumeSessionResponse,
  type SendUserMessageRequest,
  type StopSessionRequest,
  type ListProjectsResponse,
  type ListSessionsForProjectRequest,
  type ListSessionsForProjectResponse,
  type LoadHistoricalSessionRequest,
  type LoadHistoricalSessionResponse,
  type ClaudeSessionEvent,
  type ListModelProvidersResponse,
  type SaveModelProviderRequest,
  type SaveModelProviderResponse,
  type DeleteModelProviderRequest,
  type DeleteModelProviderResponse,
  type LoadPluginCatalogResponse,
  type InstallPluginRequest,
  type InstallPluginResponse,
  type UninstallPluginRequest,
  type UninstallPluginResponse,
  type ListMcpServersResponse,
  type AddMcpServerRequest,
  type AddMcpServerResponse,
  type GetClaudeVersionResponse,
  type RunDoctorRequest,
  type RunDoctorResponse,
  type GetProjectSettingsRequest,
  type GetProjectSettingsResponse,
  type OpenClaudeMdRequest,
  type OpenClaudeMdResponse,
  type GetUsageStatsResponse,
  type GetGitStatusRequest,
  type GitStatusResponse,
  type GetGitWorktreesRequest,
  type GitWorktreesResponse,
  type GetGitDiffRequest,
  type GetGitDiffResponse,
  type ListDirEntriesRequest,
  type ListDirEntriesResponse,
  type GetFilePreviewRequest,
  type GetFilePreviewResponse,
  type SetProjectPinnedRequest,
  type SetProjectCollapsedRequest,
  type RenameProjectRequest,
  type RemoveProjectRequest,
  type ArchiveSessionRequest,
  type RemoveSessionRequest,
  type ShowInFinderRequest,
  type ShowInFinderResponse,
  type OpenExternalRequest,
  type OpenExternalResponse,
  type CreateWorktreeRequest,
  type CreateWorktreeResponse,
  type ForkSessionRequest,
  type ForkSessionResponse,
  type GetEnvConfigResponse,
  type GetAuthStatusResponse,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type WriteTerminalRequest,
  type ResizeTerminalRequest,
  type DisposeTerminalRequest,
  type TerminalEvent,
} from '../shared/ipc';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  claude: {
    startOrResumeSession: (req: StartOrResumeSessionRequest): Promise<StartOrResumeSessionResponse> =>
      ipcRenderer.invoke(IPC.startOrResumeSession, req),
    sendUserMessage: (req: SendUserMessageRequest): Promise<void> => ipcRenderer.invoke(IPC.sendUserMessage, req),
    stopSession: (req: StopSessionRequest): Promise<void> => ipcRenderer.invoke(IPC.stopSession, req),
    listProjects: (): Promise<ListProjectsResponse> => ipcRenderer.invoke(IPC.listProjects),
    listSessionsForProject: (req: ListSessionsForProjectRequest): Promise<ListSessionsForProjectResponse> =>
      ipcRenderer.invoke(IPC.listSessionsForProject, req),
    loadHistoricalSession: (req: LoadHistoricalSessionRequest): Promise<LoadHistoricalSessionResponse> =>
      ipcRenderer.invoke(IPC.loadHistoricalSession, req),
    listModelProviders: (): Promise<ListModelProvidersResponse> => ipcRenderer.invoke(IPC.listModelProviders),
    saveModelProvider: (req: SaveModelProviderRequest): Promise<SaveModelProviderResponse> =>
      ipcRenderer.invoke(IPC.saveModelProvider, req),
    deleteModelProvider: (req: DeleteModelProviderRequest): Promise<DeleteModelProviderResponse> =>
      ipcRenderer.invoke(IPC.deleteModelProvider, req),
    loadPluginCatalog: (): Promise<LoadPluginCatalogResponse> => ipcRenderer.invoke(IPC.loadPluginCatalog),
    installPlugin: (req: InstallPluginRequest): Promise<InstallPluginResponse> =>
      ipcRenderer.invoke(IPC.installPlugin, req),
    uninstallPlugin: (req: UninstallPluginRequest): Promise<UninstallPluginResponse> =>
      ipcRenderer.invoke(IPC.uninstallPlugin, req),
    listMcpServers: (): Promise<ListMcpServersResponse> => ipcRenderer.invoke(IPC.listMcpServers),
    addMcpServer: (req: AddMcpServerRequest): Promise<AddMcpServerResponse> =>
      ipcRenderer.invoke(IPC.addMcpServer, req),
    getClaudeVersion: (): Promise<GetClaudeVersionResponse> => ipcRenderer.invoke(IPC.getClaudeVersion),
    runDoctor: (req: RunDoctorRequest): Promise<RunDoctorResponse> => ipcRenderer.invoke(IPC.runDoctor, req),
    getProjectSettings: (req: GetProjectSettingsRequest): Promise<GetProjectSettingsResponse> =>
      ipcRenderer.invoke(IPC.getProjectSettings, req),
    openClaudeMd: (req: OpenClaudeMdRequest): Promise<OpenClaudeMdResponse> =>
      ipcRenderer.invoke(IPC.openClaudeMd, req),
    getUsageStats: (): Promise<GetUsageStatsResponse> => ipcRenderer.invoke(IPC.getUsageStats),
    getGitStatus: (req: GetGitStatusRequest): Promise<GitStatusResponse> =>
      ipcRenderer.invoke(IPC.getGitStatus, req),
    getGitWorktrees: (req: GetGitWorktreesRequest): Promise<GitWorktreesResponse> =>
      ipcRenderer.invoke(IPC.getGitWorktrees, req),
    getGitDiff: (req: GetGitDiffRequest): Promise<GetGitDiffResponse> => ipcRenderer.invoke(IPC.getGitDiff, req),
    listDirEntries: (req: ListDirEntriesRequest): Promise<ListDirEntriesResponse> =>
      ipcRenderer.invoke(IPC.listDirEntries, req),
    getFilePreview: (req: GetFilePreviewRequest): Promise<GetFilePreviewResponse> =>
      ipcRenderer.invoke(IPC.getFilePreview, req),
    setProjectPinned: (req: SetProjectPinnedRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.setProjectPinned, req),
    setProjectCollapsed: (req: SetProjectCollapsedRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.setProjectCollapsed, req),
    renameProject: (req: RenameProjectRequest): Promise<void> => ipcRenderer.invoke(IPC.renameProject, req),
    removeProject: (req: RemoveProjectRequest): Promise<void> => ipcRenderer.invoke(IPC.removeProject, req),
    archiveSession: (req: ArchiveSessionRequest): Promise<void> => ipcRenderer.invoke(IPC.archiveSession, req),
    removeSession: (req: RemoveSessionRequest): Promise<void> => ipcRenderer.invoke(IPC.removeSession, req),
    showInFinder: (req: ShowInFinderRequest): Promise<ShowInFinderResponse> =>
      ipcRenderer.invoke(IPC.showInFinder, req),
    openExternal: (req: OpenExternalRequest): Promise<OpenExternalResponse> =>
      ipcRenderer.invoke(IPC.openExternal, req),
    createWorktree: (req: CreateWorktreeRequest): Promise<CreateWorktreeResponse> =>
      ipcRenderer.invoke(IPC.createWorktree, req),
    forkSession: (req: ForkSessionRequest): Promise<ForkSessionResponse> =>
      ipcRenderer.invoke(IPC.forkSession, req),
    getEnvConfig: (): Promise<GetEnvConfigResponse> => ipcRenderer.invoke(IPC.getEnvConfig),
    getAuthStatus: (): Promise<GetAuthStatusResponse> => ipcRenderer.invoke(IPC.getAuthStatus),
    onSessionEvent: (cb: (event: ClaudeSessionEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: ClaudeSessionEvent) => cb(event);
      ipcRenderer.on(IPC.sessionEvent, listener);
      return () => ipcRenderer.removeListener(IPC.sessionEvent, listener);
    },
    createTerminal: (req: CreateTerminalRequest): Promise<CreateTerminalResponse> =>
      ipcRenderer.invoke(IPC.createTerminal, req),
    writeTerminal: (req: WriteTerminalRequest): Promise<void> => ipcRenderer.invoke(IPC.writeTerminal, req),
    resizeTerminal: (req: ResizeTerminalRequest): Promise<void> => ipcRenderer.invoke(IPC.resizeTerminal, req),
    disposeTerminal: (req: DisposeTerminalRequest): Promise<void> => ipcRenderer.invoke(IPC.disposeTerminal, req),
    onTerminalEvent: (cb: (event: TerminalEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: TerminalEvent) => cb(event);
      ipcRenderer.on(IPC.terminalEvent, listener);
      return () => ipcRenderer.removeListener(IPC.terminalEvent, listener);
    },
  },
});
