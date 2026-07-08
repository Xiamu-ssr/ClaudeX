import type { Session, Step } from './chat';

export const IPC = {
  startOrResumeSession: 'claude:startOrResumeSession',
  sendUserMessage: 'claude:sendUserMessage',
  stopSession: 'claude:stopSession',
  listProjects: 'claude:listProjects',
  listSessionsForProject: 'claude:listSessionsForProject',
  loadHistoricalSession: 'claude:loadHistoricalSession',
  sessionEvent: 'claude:sessionEvent',
  listModelProviders: 'claude:listModelProviders',
  saveModelProvider: 'claude:saveModelProvider',
  deleteModelProvider: 'claude:deleteModelProvider',
  loadPluginCatalog: 'claude:loadPluginCatalog',
  installPlugin: 'claude:installPlugin',
  uninstallPlugin: 'claude:uninstallPlugin',
  listMcpServers: 'claude:listMcpServers',
  addMcpServer: 'claude:addMcpServer',
  getClaudeVersion: 'claude:getClaudeVersion',
  runDoctor: 'claude:runDoctor',
  getProjectSettings: 'claude:getProjectSettings',
  openClaudeMd: 'claude:openClaudeMd',
  getUsageStats: 'claude:getUsageStats',
  getGitStatus: 'claude:getGitStatus',
  getGitWorktrees: 'claude:getGitWorktrees',
  getGitDiff: 'claude:getGitDiff',
  getContextUsage: 'claude:getContextUsage',
  listDirEntries: 'claude:listDirEntries',
  getFilePreview: 'claude:getFilePreview',
  setProjectPinned: 'claude:setProjectPinned',
  setProjectCollapsed: 'claude:setProjectCollapsed',
  renameProject: 'claude:renameProject',
  removeProject: 'claude:removeProject',
  archiveSession: 'claude:archiveSession',
  removeSession: 'claude:removeSession',
  showInFinder: 'claude:showInFinder',
  openExternal: 'claude:openExternal',
  createWorktree: 'claude:createWorktree',
  forkSession: 'claude:forkSession',
  getEnvConfig: 'claude:getEnvConfig',
  getAuthStatus: 'claude:getAuthStatus',
  createTerminal: 'terminal:create',
  writeTerminal: 'terminal:write',
  resizeTerminal: 'terminal:resize',
  disposeTerminal: 'terminal:dispose',
  terminalEvent: 'terminal:event',
} as const;

export type PermissionMode = 'bypassPermissions' | 'default';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface StartOrResumeSessionRequest {
  cwd: string;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
  model?: string;
  effort?: EffortLevel;
  extraEnv?: Record<string, string>;
}
export interface StartOrResumeSessionResponse {
  sessionId: string;
}

export interface ModelOption {
  id: string;
  label: string;
}

// A provider is a named group of models plus environment variable overrides
// injected into the spawned `claude` process — this mirrors Claude Code's own
// exposed configuration surface (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN /
// ANTHROPIC_API_KEY / CLAUDE_CODE_USE_BEDROCK / CLAUDE_CODE_USE_VERTEX, etc.)
// rather than a fixed set of hardcoded integrations.
export interface ModelProviderConfig {
  id: string;
  name: string;
  builtin: boolean;
  env: Record<string, string>;
  models: ModelOption[];
}

export interface ListModelProvidersResponse {
  providers: ModelProviderConfig[];
}
export interface SaveModelProviderRequest {
  provider: ModelProviderConfig;
}
export interface SaveModelProviderResponse {
  providers: ModelProviderConfig[];
}
export interface DeleteModelProviderRequest {
  id: string;
}
export interface DeleteModelProviderResponse {
  providers: ModelProviderConfig[];
}

export interface OutgoingAttachment {
  mimeType: string;
  base64Data: string;
}

export interface SendUserMessageRequest {
  sessionId: string;
  text: string;
  attachments?: OutgoingAttachment[];
}

export interface StopSessionRequest {
  sessionId: string;
}

export interface ProjectSummary {
  encodedDirName: string;
  cwd: string;
  displayName: string;
  sessionCount: number;
  lastActiveAt: string | null;
  pinned: boolean;
  collapsed: boolean;
}
export interface ListProjectsResponse {
  projects: ProjectSummary[];
}

export interface SessionListEntry {
  sessionId: string;
  title: string;
  lastActiveAt: string;
  cwd: string;
}
export interface ListSessionsForProjectRequest {
  cwd: string;
}
export interface ListSessionsForProjectResponse {
  sessions: SessionListEntry[];
}

export interface SetProjectPinnedRequest {
  cwd: string;
  pinned: boolean;
}
export interface SetProjectCollapsedRequest {
  cwd: string;
  collapsed: boolean;
}
export interface RenameProjectRequest {
  cwd: string;
  customName: string;
}
export interface RemoveProjectRequest {
  cwd: string;
}
export interface ArchiveSessionRequest {
  sessionId: string;
}
export interface RemoveSessionRequest {
  sessionId: string;
}
export interface ShowInFinderRequest {
  path: string;
}
export interface ShowInFinderResponse {
  ok: boolean;
  message?: string;
}
export interface OpenExternalRequest {
  url: string;
}

export interface OpenExternalResponse {
  ok: boolean;
}
export interface CreateWorktreeRequest {
  cwd: string;
  branch: string;
}
export interface CreateWorktreeResponse {
  ok: boolean;
  worktreePath?: string;
  message?: string;
}
export interface ForkSessionRequest {
  cwd: string;
  sourceSessionId: string;
}
export interface ForkSessionResponse {
  ok: boolean;
  newSessionId?: string;
  message?: string;
}

export interface LoadHistoricalSessionRequest {
  cwd: string;
  sessionId: string;
}
export interface LoadHistoricalSessionResponse {
  session: Session;
}

// All of the following are derived from Claude Code's own on-disk/CLI-exposed
// surface — `claude plugin list --available --json` for the marketplace catalog
// and `~/.claude.json`'s `mcpServers` key for what's actually configured — rather
// than any data invented by CCodeBox itself.
export interface CatalogPlugin {
  id: string;
  name: string;
  description: string;
  installCount: number;
  // Whether `claude plugin install` has this plugin registered, per
  // `claude plugin list --json` — not related to CustomMcpServer below.
  installed: boolean;
}
// Connector plugins are MCP-server-backed marketplace entries. They carry one
// extra field beyond CatalogPlugin: whether an MCP server of the same name is
// already configured directly (e.g. via `claude mcp add`, outside the plugin/
// marketplace install system) — installing this connector would collide with
// that config and the CLI rejects it.
export interface ConnectorPlugin extends CatalogPlugin {
  // True when an MCP server of this same name is already configured directly (e.g. via
  // `claude mcp add`, outside the plugin/marketplace install system) — installing this
  // connector would collide with that config and the CLI rejects it.
  configuredOutsidePlugin: boolean;
}
// Third-party marketplace plugins (source outside the two known first-party local
// paths). A plugin's own JSON never states which marketplace it came from, so the
// marketplace name is derived by splitting id on '@' — the same convention already
// used by readInstalledPluginNames for the installed-plugin id shape.
export interface ThirdPartyPlugin extends CatalogPlugin {
  marketplace: string;
}
export interface CustomMcpServer {
  name: string;
}
export interface PluginCatalog {
  connectors: ConnectorPlugin[];
  customMcpServers: CustomMcpServer[];
  officialSkills: CatalogPlugin[];
  personalSkills: CatalogPlugin[];
  thirdPartyPlugins: ThirdPartyPlugin[];
}
export interface LoadPluginCatalogResponse {
  catalog: PluginCatalog;
}

export interface InstallPluginRequest {
  pluginId: string; // "<name>@<marketplace>", as returned by CatalogPlugin.id
}
export interface InstallPluginResponse {
  ok: boolean;
  message: string;
}
export interface UninstallPluginRequest {
  pluginName: string;
}
export interface UninstallPluginResponse {
  ok: boolean;
  message: string;
}

// name/type only — see main/plugins/pluginCatalog.ts for why the raw server
// config (which can embed API keys/tokens) never leaves the main process.
export interface McpServerSummary {
  name: string;
  type: string;
}
export interface ListMcpServersResponse {
  servers: McpServerSummary[];
}

export interface AddMcpServerRequest {
  name: string;
  command: string;
  args: string[];
}
export interface AddMcpServerResponse {
  ok: boolean;
  message: string;
}

// The following are all real, locally-derivable facts about the Claude Code CLI
// installation and the currently selected project — never invented numbers. See
// main/system/*.ts for where each one is read from.

export interface GetClaudeVersionResponse {
  version: string | null; // null if the CLI couldn't be resolved/executed
}

export interface RunDoctorRequest {
  cwd: string;
}
export interface RunDoctorResponse {
  output: string;
  ok: boolean;
}

export interface HookMatcherEntry {
  matcher?: string;
  commands: string[];
}
// Keyed dynamically by whatever hook event names are actually present in the
// merged settings files — deliberately not a fixed enum, since Claude Code's
// hook event list has grown over time and a hardcoded list would go stale.
export type HooksConfig = Record<string, HookMatcherEntry[]>;

export interface PermissionsConfig {
  allow: string[];
  ask: string[];
  deny: string[];
  defaultMode?: string;
}

export interface GetProjectSettingsRequest {
  cwd: string;
}
export interface GetProjectSettingsResponse {
  hooks: HooksConfig;
  permissions: PermissionsConfig;
}

export interface OpenClaudeMdRequest {
  cwd: string;
}
export interface OpenClaudeMdResponse {
  exists: boolean;
}

export interface ProjectUsageBreakdown {
  cwd: string;
  sessionCount: number;
  totalTokens: number;
}
export interface SkillUsageEntry {
  name: string;
  usageCount: number;
  lastUsedAt: number | null;
}
export interface DailyUsageEntry {
  date: string;
  tokens: number;
}
export interface UsageStats {
  totalSessions: number;
  totalProjects: number;
  totalTokens: number;
  currentStreakDays: number;
  longestStreakDays: number;
  skillsExploredCount: number;
  totalSkillUsageCount: number;
  topSkills: SkillUsageEntry[];
  perProject: ProjectUsageBreakdown[];
  dailyUsage: DailyUsageEntry[];
  peakDayTokens: number;
}
export interface GetUsageStatsResponse {
  stats: UsageStats;
}

export interface GetGitStatusRequest {
  cwd: string;
}
export interface GitStatusResponse {
  isRepo: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  dirtyCount?: number;
}

export interface GetGitWorktreesRequest {
  cwd: string;
}
export interface GitWorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}
export interface GitWorktreesResponse {
  isRepo: boolean;
  worktrees: GitWorktreeEntry[];
}

export interface GetGitDiffRequest {
  cwd: string;
}
export interface GitFileDiff {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
  diff: string;
}
export interface GetGitDiffResponse {
  isRepo: boolean;
  files: GitFileDiff[];
}

export interface ContextUsageCategory {
  label: string;
  tokens: number;
  percent: number;
}
export interface ContextUsageSnapshot {
  modelLabel: string;
  usedTokens: number;
  totalTokens: number;
  usedPercent: number;
  categories: ContextUsageCategory[];
}
export interface GetContextUsageRequest {
  sessionId: string;
}
export interface GetContextUsageResponse {
  ok: boolean;
  usage?: ContextUsageSnapshot;
  message?: string;
}

export interface FileTreeEntry {
  name: string;
  relativePath: string;
  isDirectory: boolean;
}
export interface ListDirEntriesRequest {
  cwd: string;
  relativePath: string;
}
export interface ListDirEntriesResponse {
  entries: FileTreeEntry[];
}
export interface GetFilePreviewRequest {
  cwd: string;
  relativePath: string;
}
export interface GetFilePreviewResponse {
  content: string | null;
  reason?: 'binary' | 'too-large' | 'not-found';
}

// name + masked value only — see main/system/settingsReader.ts for why the raw
// value never crosses into the renderer.
export interface EnvVarSummary {
  key: string;
  maskedValue: string;
}
export interface GetEnvConfigResponse {
  vars: EnvVarSummary[];
}

// Real local CLI/account identity, from `claude auth status --json` — no email/username/
// subscription tier is available locally, so the Sidebar's identity block is built from
// exactly these three fields rather than inventing display data.
export interface AuthStatus {
  loggedIn: boolean;
  authMethod: string;
  apiProvider: string;
}
export interface GetAuthStatusResponse {
  status: AuthStatus | null; // null if the CLI is unresolvable or the command failed
}

export type ClaudeSessionEvent =
  | { kind: 'turn-step-appended'; sessionId: string; step: Step }
  | { kind: 'turn-step-updated'; sessionId: string; index: number; step: Step }
  | { kind: 'turn-response-updated'; sessionId: string; response: string }
  | { kind: 'turn-completed'; sessionId: string; processingTime: number; isError?: boolean }
  | { kind: 'process-exited'; sessionId: string; code: number | null }
  | { kind: 'process-error'; sessionId: string; message: string }
  | { kind: 'session-ready'; sessionId: string; slashCommands: string[] };

export interface CreateTerminalRequest {
  cwd: string;
  cols: number;
  rows: number;
}
export interface CreateTerminalResponse {
  terminalId: string;
}
export interface WriteTerminalRequest {
  terminalId: string;
  data: string;
}
export interface ResizeTerminalRequest {
  terminalId: string;
  cols: number;
  rows: number;
}
export interface DisposeTerminalRequest {
  terminalId: string;
}
export type TerminalEvent =
  | { kind: 'data'; terminalId: string; data: string }
  | { kind: 'exit'; terminalId: string; exitCode: number };
