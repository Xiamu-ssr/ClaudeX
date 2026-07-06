import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionManager } from './claude/SessionManager';
import { TerminalManager } from './terminal/TerminalManager';
import { listProjectDirs, listSessionsInProject, loadHistoricalSession, computeForkCutoffs } from './history/historyReader';
import { listModelProviders, saveModelProvider, deleteModelProvider } from './modelProviders';
import { setProjectPinned, setProjectCollapsed, renameProject, removeProject } from './history/projectOverrides';
import { setSessionArchived, removeSession } from './history/sessionOverrides';
import { forkSession } from './history/sessionForker';
import { loadPluginCatalog, listConfiguredMcpServers, installPlugin, uninstallPlugin } from './plugins/pluginCatalog';
import { getClaudeVersion, runDoctor } from './system/version';
import { getAuthStatus } from './system/authStatus';
import { readProjectSettings, readGlobalEnvConfig, claudeMdPath } from './system/settingsReader';
import { computeUsageStats } from './system/usageStats';
import { getGitStatus, getGitWorktrees, getGitDiff, createWorktree } from './system/git';
import { listDirEntries, getFilePreview } from './system/fileTree';
import fs from 'node:fs';
import { shell } from 'electron';
import {
  IPC,
  type StartOrResumeSessionRequest,
  type SendUserMessageRequest,
  type StopSessionRequest,
  type ListSessionsForProjectRequest,
  type LoadHistoricalSessionRequest,
  type SaveModelProviderRequest,
  type DeleteModelProviderRequest,
  type RunDoctorRequest,
  type GetProjectSettingsRequest,
  type OpenClaudeMdRequest,
  type GetGitStatusRequest,
  type GetGitWorktreesRequest,
  type GetGitDiffRequest,
  type ListDirEntriesRequest,
  type GetFilePreviewRequest,
  type SetProjectPinnedRequest,
  type SetProjectCollapsedRequest,
  type RenameProjectRequest,
  type RemoveProjectRequest,
  type ArchiveSessionRequest,
  type RemoveSessionRequest,
  type ShowInFinderRequest,
  type OpenExternalRequest,
  type CreateWorktreeRequest,
  type ForkSessionRequest,
  type InstallPluginRequest,
  type UninstallPluginRequest,
  type CreateTerminalRequest,
  type WriteTerminalRequest,
  type ResizeTerminalRequest,
  type DisposeTerminalRequest,
} from '../shared/ipc';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;

const sessionManager = new SessionManager((event) => {
  mainWindow?.webContents.send(IPC.sessionEvent, event);
});

const terminalManager = new TerminalManager((event) => {
  mainWindow?.webContents.send(IPC.terminalEvent, event);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
}

ipcMain.handle(IPC.startOrResumeSession, (_event, req: StartOrResumeSessionRequest) => {
  const sessionId = req.resumeSessionId ?? randomUUID();
  sessionManager.create({
    sessionId,
    cwd: req.cwd,
    resumeSessionId: req.resumeSessionId,
    permissionMode: req.permissionMode,
    model: req.model,
    effort: req.effort,
    extraEnv: req.extraEnv,
  });
  return { sessionId };
});

ipcMain.handle(IPC.sendUserMessage, (_event, req: SendUserMessageRequest) => {
  const session = sessionManager.get(req.sessionId);
  if (!session) throw new Error(`No active session: ${req.sessionId}`);
  session.sendUserMessage(req.text, req.attachments);
});

ipcMain.handle(IPC.stopSession, async (_event, req: StopSessionRequest) => {
  await sessionManager.get(req.sessionId)?.stop();
  sessionManager.remove(req.sessionId);
});

ipcMain.handle(IPC.listModelProviders, () => {
  return { providers: listModelProviders() };
});

ipcMain.handle(IPC.saveModelProvider, (_event, req: SaveModelProviderRequest) => {
  return { providers: saveModelProvider(req.provider) };
});

ipcMain.handle(IPC.deleteModelProvider, (_event, req: DeleteModelProviderRequest) => {
  return { providers: deleteModelProvider(req.id) };
});

ipcMain.handle(IPC.listProjects, () => {
  return { projects: listProjectDirs() };
});

ipcMain.handle(IPC.listSessionsForProject, (_event, req: ListSessionsForProjectRequest) => {
  return { sessions: listSessionsInProject(req.cwd) };
});

ipcMain.handle(IPC.loadHistoricalSession, (_event, req: LoadHistoricalSessionRequest) => {
  return { session: loadHistoricalSession(req.cwd, req.sessionId) };
});

ipcMain.handle(IPC.loadPluginCatalog, async () => {
  return { catalog: await loadPluginCatalog() };
});

ipcMain.handle(IPC.installPlugin, (_event, req: InstallPluginRequest) => {
  return installPlugin(req.pluginId);
});

ipcMain.handle(IPC.uninstallPlugin, (_event, req: UninstallPluginRequest) => {
  return uninstallPlugin(req.pluginName);
});

ipcMain.handle(IPC.listMcpServers, () => {
  return { servers: listConfiguredMcpServers() };
});

ipcMain.handle(IPC.getClaudeVersion, async () => {
  return { version: await getClaudeVersion() };
});

ipcMain.handle(IPC.runDoctor, async (_event, req: RunDoctorRequest) => {
  return runDoctor(req.cwd);
});

ipcMain.handle(IPC.getProjectSettings, (_event, req: GetProjectSettingsRequest) => {
  return readProjectSettings(req.cwd);
});

ipcMain.handle(IPC.openClaudeMd, async (_event, req: OpenClaudeMdRequest) => {
  const filePath = claudeMdPath(req.cwd);
  const exists = fs.existsSync(filePath);
  if (exists) await shell.openPath(filePath);
  return { exists };
});

ipcMain.handle(IPC.getUsageStats, () => {
  return { stats: computeUsageStats() };
});

ipcMain.handle(IPC.getGitStatus, (_event, req: GetGitStatusRequest) => {
  return getGitStatus(req.cwd);
});

ipcMain.handle(IPC.getGitWorktrees, (_event, req: GetGitWorktreesRequest) => {
  return getGitWorktrees(req.cwd);
});

ipcMain.handle(IPC.getGitDiff, (_event, req: GetGitDiffRequest) => {
  return getGitDiff(req.cwd);
});

ipcMain.handle(IPC.listDirEntries, (_event, req: ListDirEntriesRequest) => {
  return listDirEntries(req.cwd, req.relativePath);
});

ipcMain.handle(IPC.getFilePreview, (_event, req: GetFilePreviewRequest) => {
  return getFilePreview(req.cwd, req.relativePath);
});

ipcMain.handle(IPC.setProjectPinned, (_event, req: SetProjectPinnedRequest) => {
  setProjectPinned(req.cwd, req.pinned);
});

ipcMain.handle(IPC.setProjectCollapsed, (_event, req: SetProjectCollapsedRequest) => {
  setProjectCollapsed(req.cwd, req.collapsed);
});

ipcMain.handle(IPC.renameProject, (_event, req: RenameProjectRequest) => {
  renameProject(req.cwd, req.customName);
});

ipcMain.handle(IPC.removeProject, (_event, req: RemoveProjectRequest) => {
  removeProject(req.cwd);
});

ipcMain.handle(IPC.archiveSession, (_event, req: ArchiveSessionRequest) => {
  setSessionArchived(req.sessionId);
});

ipcMain.handle(IPC.removeSession, (_event, req: RemoveSessionRequest) => {
  removeSession(req.sessionId);
});

ipcMain.handle(IPC.showInFinder, (_event, req: ShowInFinderRequest) => {
  if (!fs.existsSync(req.path)) {
    return { ok: false, message: '路径不存在' };
  }
  shell.showItemInFolder(req.path);
  return { ok: true };
});

ipcMain.handle(IPC.openExternal, async (_event, req: OpenExternalRequest) => {
  let parsed: URL;
  try {
    parsed = new URL(req.url);
  } catch {
    return { ok: false };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false };
  }
  await shell.openExternal(req.url);
  return { ok: true };
});

ipcMain.handle(IPC.createWorktree, (_event, req: CreateWorktreeRequest) => {
  return createWorktree(req.cwd, req.branch);
});

ipcMain.handle(IPC.forkSession, (_event, req: ForkSessionRequest) => {
  const cutoffs = computeForkCutoffs(req.cwd, req.sourceSessionId);
  if (cutoffs.length === 0) return { ok: false, message: '没有可分叉的完整对话轮次' };
  const latestTurnIndex = cutoffs[cutoffs.length - 1].turnIndex;
  return forkSession(req.cwd, req.sourceSessionId, latestTurnIndex);
});

ipcMain.handle(IPC.getEnvConfig, () => {
  return { vars: readGlobalEnvConfig() };
});

ipcMain.handle(IPC.getAuthStatus, async () => {
  return { status: await getAuthStatus() };
});

ipcMain.handle(IPC.createTerminal, (_event, req: CreateTerminalRequest) => {
  return { terminalId: terminalManager.create(req.cwd, req.cols, req.rows) };
});

ipcMain.handle(IPC.writeTerminal, (_event, req: WriteTerminalRequest) => {
  terminalManager.write(req.terminalId, req.data);
});

ipcMain.handle(IPC.resizeTerminal, (_event, req: ResizeTerminalRequest) => {
  terminalManager.resize(req.terminalId, req.cols, req.rows);
});

ipcMain.handle(IPC.disposeTerminal, (_event, req: DisposeTerminalRequest) => {
  terminalManager.dispose(req.terminalId);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  sessionManager.stopAll();
  terminalManager.disposeAll();
});
