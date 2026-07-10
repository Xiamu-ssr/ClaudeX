import { useEffect, useState } from 'react';
import { SquarePen, Search, AtSign, User, Settings, Ellipsis, ChevronRight, ChevronDown, Pin, Folder, FolderOpen } from 'lucide-react';
import type { AppView } from '../App';
import { useSessionStore } from '../store/sessionStore';
import type { AuthStatus } from '../../shared/ipc';
import { ProjectContextMenu } from './ProjectContextMenu';
import { SessionContextMenu } from './SessionContextMenu';

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 时`;
  const days = Math.round(hours / 24);
  return `${days} 天`;
}

function sessionMenuKey(cwd: string, sessionId: string): string {
  return `${cwd}\u0000${sessionId}`;
}

// `claude auth status --json` never returns a display name/email/subscription tier — those
// don't exist locally. authMethod/apiProvider are the only real identity facts available, so
// they're mapped to friendly labels rather than inventing anything beyond them.
function friendlyAuthMethod(method: string): string {
  if (method === 'oauth_token') return 'OAuth 登录';
  if (method === 'api_key' || method === 'apiKey') return 'API Key 登录';
  return method;
}

function friendlyApiProvider(provider: string): string {
  if (provider === 'firstParty') return '官方账户';
  return provider;
}

interface SidebarProps {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
}

export function Sidebar({ currentView, onNavigate }: SidebarProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [expandedSessionLists, setExpandedSessionLists] = useState<Record<string, boolean>>({});
  const [openMenuCwd, setOpenMenuCwd] = useState<string | null>(null);
  const [renamingCwd, setRenamingCwd] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(null);
  const [renamingSessionKey, setRenamingSessionKey] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [sessionRenameValue, setSessionRenameValue] = useState('');

  const projects = useSessionStore((s) => s.projects);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const loadProjectList = useSessionStore((s) => s.loadProjectList);
  const openHistoricalSession = useSessionStore((s) => s.openHistoricalSession);
  const loadModelProviders = useSessionStore((s) => s.loadModelProviders);
  const setSelectedProjectCwd = useSessionStore((s) => s.setSelectedProjectCwd);
  const renameProject = useSessionStore((s) => s.renameProject);
  const renameSession = useSessionStore((s) => s.renameSession);
  const setProjectCollapsed = useSessionStore((s) => s.setProjectCollapsed);

  useEffect(() => {
    loadProjectList();
    loadModelProviders();
    window.electronAPI.claude.getAuthStatus().then(({ status }) => setAuthStatus(status));
  }, [loadProjectList, loadModelProviders]);

  const handleOpenSession = async (cwd: string, sessionId: string) => {
    await openHistoricalSession(cwd, sessionId);
    onNavigate('chat');
  };

  const toggleSearch = () => {
    setSearchOpen((open) => {
      if (open) setSearchQuery('');
      return !open;
    });
  };

  const toggleCollapsed = (cwd: string, collapsed: boolean) => {
    setProjectCollapsed(cwd, !collapsed);
  };

  const commitRename = () => {
    if (renamingCwd === null) return;
    const cwd = renamingCwd;
    const trimmed = renameValue.trim();
    setRenamingCwd(null);
    if (trimmed) renameProject(cwd, trimmed);
  };

  const commitSessionRename = () => {
    if (renamingSessionId === null) return;
    const sessionId = renamingSessionId;
    const trimmed = sessionRenameValue.trim();
    setRenamingSessionKey(null);
    setRenamingSessionId(null);
    if (trimmed) void renameSession(sessionId, trimmed);
  };

  const query = searchQuery.trim().toLowerCase();
  const isFiltering = searchOpen && query.length > 0;

  function projectSessions(cwd: string) {
    const sessions = sessionsByProject[cwd] ?? [];
    if (!isFiltering) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(query));
  }

  const SESSION_LIST_CAP = 5;

  function visibleSessions(cwd: string) {
    const sessions = projectSessions(cwd);
    if (isFiltering || expandedSessionLists[cwd]) return sessions;
    return sessions.slice(0, SESSION_LIST_CAP);
  }

  function hiddenSessionCount(cwd: string) {
    if (isFiltering || expandedSessionLists[cwd]) return 0;
    return Math.max(0, projectSessions(cwd).length - SESSION_LIST_CAP);
  }

  const visibleProjects = projects.filter((project) => {
    if (!isFiltering) return true;
    if (project.displayName.toLowerCase().includes(query)) return true;
    return projectSessions(project.cwd).length > 0;
  });

  return (
    <aside className="w-60 bg-black/20 flex flex-col h-full shrink-0 relative border-r border-white/[0.10]">
      {/* Traffic light spacing */}
      <div className="h-[52px] drag shrink-0" />

      {/* Scrollable middle section */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Menu items */}
        <nav className="px-4 space-y-1">
          <button
            onClick={() => onNavigate('home')}
            className="no-drag w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-[15px] font-medium text-white hover:bg-white/5 transition-colors"
          >
            <SquarePen size={18} strokeWidth={1.8} />
            新对话
          </button>
          <button
            onClick={toggleSearch}
            className={`no-drag w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-[15px] font-medium transition-colors ${
              searchOpen ? 'bg-white/8 text-white' : 'text-white hover:bg-white/5'
            }`}
          >
            <Search size={18} strokeWidth={1.8} />
            搜索
          </button>
          {searchOpen && (
            <div className="px-1 pt-0.5 pb-1">
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索项目和对话..."
                className="w-full bg-card border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-text-secondary outline-none focus:border-neutral-500 transition-colors"
              />
            </div>
          )}
          <button
            onClick={() => onNavigate('plugins')}
            className={`no-drag w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-[15px] font-medium transition-colors ${
              currentView === 'plugins' ? 'bg-white/8 text-white' : 'text-white hover:bg-white/5'
            }`}
          >
            <AtSign size={18} strokeWidth={1.8} />
            插件
          </button>
        </nav>

        {/* Projects */}
        <div className="mt-8 px-4">
          <div className="text-[13px] text-white/45 font-medium px-2.5 mb-2">
            项目
          </div>
          {isFiltering && visibleProjects.length === 0 ? (
            <div className="px-2 py-3 text-xs text-white/50">没有匹配的项目或对话</div>
          ) : (
            <div className="space-y-0.5">
              {visibleProjects.map((project) => (
                <div key={project.cwd}>
                  <div data-testid="project-row" className="no-drag group/project relative flex items-center rounded-lg hover:bg-white/5 transition-colors">
                    <button
                      onClick={() => toggleCollapsed(project.cwd, project.collapsed)}
                      aria-label={project.collapsed ? '展开项目' : '折叠项目'}
                      className="p-1.5 shrink-0 text-neutral-500 hover:text-neutral-300"
                    >
                      {project.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>

                    {renamingCwd === project.cwd ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setRenamingCwd(null);
                        }}
                        onBlur={commitRename}
                        className="flex-1 min-w-0 bg-card border border-card-border rounded-md px-1.5 py-1 text-sm text-white outline-none focus:border-neutral-500"
                      />
                    ) : (
                      <button
                        onClick={() => setSelectedProjectCwd(project.cwd)}
                        className="flex-1 min-w-0 flex items-center gap-2 px-1 py-1.5 rounded-lg text-[15px] font-medium text-white transition-colors text-left"
                      >
                        {project.pinned && <Pin size={12} className="shrink-0 text-white/50" strokeWidth={1.8} />}
                        {project.collapsed ? (
                          <Folder size={18} strokeWidth={1.7} className="shrink-0 text-white/80" />
                        ) : (
                          <FolderOpen size={18} strokeWidth={1.7} className="shrink-0 text-white/80" />
                        )}
                        <span className="truncate">{project.displayName}</span>
                      </button>
                    )}

                    <button
                      onClick={() => setOpenMenuCwd(project.cwd)}
                      aria-label="项目菜单"
                      className="p-1.5 shrink-0 opacity-0 group-hover/project:opacity-100 transition-opacity text-neutral-500 hover:text-neutral-300"
                    >
                      <Ellipsis size={14} />
                    </button>

                    {openMenuCwd === project.cwd && (
                      <ProjectContextMenu
                        cwd={project.cwd}
                        pinned={project.pinned}
                        onClose={() => setOpenMenuCwd(null)}
                        onStartRename={() => {
                          setRenameValue(project.displayName);
                          setRenamingCwd(project.cwd);
                          setOpenMenuCwd(null);
                        }}
                      />
                    )}
                  </div>

                  {!project.collapsed &&
                    visibleSessions(project.cwd).map((session) => (
                      <div
                        key={sessionMenuKey(project.cwd, session.sessionId)}
                        className={`no-drag group/session relative flex items-center rounded-lg transition-colors ${
                          currentView === 'chat' && activeSessionId === session.sessionId
                            ? 'bg-white/8 text-white'
                            : 'text-white/70 hover:bg-white/5'
                        }`}
                      >
                        {renamingSessionKey === sessionMenuKey(project.cwd, session.sessionId) ? (
                          <input
                            autoFocus
                            value={sessionRenameValue}
                            onChange={(e) => setSessionRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitSessionRename();
                              if (e.key === 'Escape') {
                                setRenamingSessionKey(null);
                                setRenamingSessionId(null);
                              }
                            }}
                            onBlur={commitSessionRename}
                            className="ml-[50px] flex-1 min-w-0 bg-card border border-card-border rounded-md px-2 py-1 text-[13px] text-white outline-none focus:border-neutral-500"
                          />
                        ) : (
                          <button
                            onClick={() => handleOpenSession(project.cwd, session.sessionId)}
                            className="flex-1 min-w-0 flex items-center gap-2 pl-[50px] pr-1.5 py-2 text-sm transition-colors"
                          >
                            <span className="truncate flex-1 text-left text-[13px]">{session.title}</span>
                            <span className="text-xs text-white/45 shrink-0 opacity-0 group-hover/session:opacity-100 transition-opacity">
                              {formatRelativeTime(session.lastActiveAt)}
                            </span>
                          </button>
                        )}
                        <button
                          onClick={() => setOpenSessionMenuKey(sessionMenuKey(project.cwd, session.sessionId))}
                          aria-label="会话菜单"
                          className="mr-1 p-1 shrink-0 opacity-0 group-hover/session:opacity-100 text-neutral-500 hover:text-neutral-200 transition-opacity"
                        >
                          <Ellipsis size={15} />
                        </button>
                        {openSessionMenuKey === sessionMenuKey(project.cwd, session.sessionId) && (
                          <SessionContextMenu
                            sessionId={session.sessionId}
                            onClose={() => setOpenSessionMenuKey(null)}
                            onStartRename={() => {
                              setSessionRenameValue(session.title);
                              setRenamingSessionKey(sessionMenuKey(project.cwd, session.sessionId));
                              setRenamingSessionId(session.sessionId);
                              setOpenSessionMenuKey(null);
                            }}
                          />
                        )}
                      </div>
                    ))}
                  {!project.collapsed && hiddenSessionCount(project.cwd) > 0 && (
                    <button
                      onClick={() => setExpandedSessionLists((prev) => ({ ...prev, [project.cwd]: true }))}
                      className="no-drag w-full flex items-center gap-2 pl-[50px] pr-2 py-2 rounded-lg text-xs text-white/50 hover:bg-white/5 hover:text-neutral-300 transition-colors"
                    >
                      显示更多（还有 {hiddenSessionCount(project.cwd)} 个）
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* User info + menu */}
      <div className="px-3 py-3 relative shrink-0">
        {/* User menu popover */}
        {userMenuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
            <div className="absolute bottom-full left-2 right-2 mb-1 bg-[#2a2a2c] border border-card-border rounded-xl shadow-xl z-50 overflow-hidden">
              {/* Real auth status, from `claude auth status` — no email/username available locally */}
              <div className="px-3 py-2.5 border-b border-card-border">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <User size={14} />
                  {authStatus === null
                    ? 'Claude Code CLI 不可用'
                    : authStatus.loggedIn
                      ? `已登录 · ${friendlyAuthMethod(authStatus.authMethod)}`
                      : '未登录'}
                </div>
              </div>

              <div className="py-1">
                <button
                  onClick={() => { setUserMenuOpen(false); onNavigate('settings'); }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-white hover:bg-white/5 transition-colors"
                >
                  <Settings size={14} />
                  设置
                  <span className="ml-auto text-xs text-white/50">⌘,</span>
                </button>
              </div>
            </div>
          </>
        )}

        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          aria-label="用户菜单"
          className="no-drag w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white shrink-0">
            <User size={16} strokeWidth={1.8} />
          </div>
          <div className="text-left min-w-0">
            <div className="text-sm text-white truncate">
              {authStatus === null ? 'Claude Code' : authStatus.loggedIn ? friendlyApiProvider(authStatus.apiProvider) : '未登录'}
            </div>
            <div className="text-xs text-white/50 truncate">
              {authStatus?.loggedIn ? friendlyAuthMethod(authStatus.authMethod) : ''}
            </div>
          </div>
        </button>
      </div>
    </aside>
  );
}
