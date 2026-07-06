import { useEffect, useState } from 'react';
import { SquarePen, Search, AtSign, FileText, User, Settings, Ellipsis, ChevronRight, ChevronDown, Pin } from 'lucide-react';
import type { AppView } from '../App';
import { useSessionStore } from '../store/sessionStore';
import type { AuthStatus } from '../../shared/ipc';
import { ProjectContextMenu } from './ProjectContextMenu';

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
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [openMenuCwd, setOpenMenuCwd] = useState<string | null>(null);
  const [renamingCwd, setRenamingCwd] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const projects = useSessionStore((s) => s.projects);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const loadProjectList = useSessionStore((s) => s.loadProjectList);
  const openHistoricalSession = useSessionStore((s) => s.openHistoricalSession);
  const loadModelProviders = useSessionStore((s) => s.loadModelProviders);
  const setSelectedProjectCwd = useSessionStore((s) => s.setSelectedProjectCwd);
  const renameProject = useSessionStore((s) => s.renameProject);

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

  const toggleCollapsed = (cwd: string) => {
    setCollapsedProjects((prev) => ({ ...prev, [cwd]: !prev[cwd] }));
  };

  const commitRename = () => {
    if (renamingCwd === null) return;
    const cwd = renamingCwd;
    const trimmed = renameValue.trim();
    setRenamingCwd(null);
    if (trimmed) renameProject(cwd, trimmed);
  };

  const query = searchQuery.trim().toLowerCase();
  const isFiltering = searchOpen && query.length > 0;

  function projectSessions(cwd: string) {
    const sessions = sessionsByProject[cwd] ?? [];
    if (!isFiltering) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(query));
  }

  const visibleProjects = projects.filter((project) => {
    if (!isFiltering) return true;
    if (project.displayName.toLowerCase().includes(query)) return true;
    return projectSessions(project.cwd).length > 0;
  });

  return (
    <aside className="w-60 bg-sidebar flex flex-col h-full shrink-0 relative">
      {/* Traffic light spacing */}
      <div className="h-[52px] drag shrink-0" />

      {/* Scrollable middle section */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Menu items */}
        <nav className="px-3 space-y-0.5">
          <button
            onClick={() => onNavigate('home')}
            className="no-drag w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-sm text-neutral-300 hover:bg-white/5 transition-colors"
          >
            <SquarePen size={16} strokeWidth={1.8} />
            新对话
          </button>
          <button
            onClick={toggleSearch}
            className={`no-drag w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-sm transition-colors ${
              searchOpen ? 'bg-white/8 text-white' : 'text-neutral-300 hover:bg-white/5'
            }`}
          >
            <Search size={16} strokeWidth={1.8} />
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
            className={`no-drag w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-sm transition-colors ${
              currentView === 'plugins' ? 'bg-white/8 text-white' : 'text-neutral-300 hover:bg-white/5'
            }`}
          >
            <AtSign size={16} strokeWidth={1.8} />
            插件
          </button>
        </nav>

        {/* Projects */}
        <div className="mt-6 px-3">
          <div className="text-xs text-text-tertiary font-medium px-2 mb-2">
            项目
          </div>
          {isFiltering && visibleProjects.length === 0 ? (
            <div className="px-2 py-3 text-xs text-text-tertiary">没有匹配的项目或对话</div>
          ) : (
            <div className="space-y-0.5">
              {visibleProjects.map((project) => (
                <div key={project.cwd}>
                  <div className="no-drag group/project relative flex items-center rounded-lg hover:bg-white/5 transition-colors">
                    <button
                      onClick={() => toggleCollapsed(project.cwd)}
                      aria-label={collapsedProjects[project.cwd] ? '展开项目' : '折叠项目'}
                      className="p-1.5 shrink-0 opacity-0 group-hover/project:opacity-100 transition-opacity text-neutral-500 hover:text-neutral-300"
                    >
                      {collapsedProjects[project.cwd] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
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
                        className="flex-1 min-w-0 flex items-center gap-2 px-1 py-1.5 rounded-lg text-sm text-neutral-300 transition-colors text-left"
                      >
                        {project.pinned && <Pin size={12} className="shrink-0 text-text-tertiary" strokeWidth={1.8} />}
                        <FileText size={16} strokeWidth={1.8} className="shrink-0" />
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

                  {!collapsedProjects[project.cwd] &&
                    projectSessions(project.cwd).map((session) => (
                      <button
                        key={session.sessionId}
                        onClick={() => handleOpenSession(project.cwd, session.sessionId)}
                        className={`no-drag w-full flex items-center gap-2 pl-8 pr-2 py-1.5 rounded-lg text-sm transition-colors ${
                          currentView === 'chat' && activeSessionId === session.sessionId
                            ? 'bg-white/8 text-neutral-200'
                            : 'text-neutral-400 hover:bg-white/5'
                        }`}
                      >
                        <span className="truncate flex-1 text-left text-[13px]">{session.title}</span>
                        <span className="text-xs text-text-tertiary shrink-0">
                          {formatRelativeTime(session.lastActiveAt)}
                        </span>
                      </button>
                    ))}
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
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 transition-colors"
                >
                  <Settings size={14} />
                  设置
                  <span className="ml-auto text-xs text-text-tertiary">⌘,</span>
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
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-neutral-300 shrink-0">
            <User size={16} strokeWidth={1.8} />
          </div>
          <div className="text-left min-w-0">
            <div className="text-sm text-neutral-200 truncate">
              {authStatus === null ? 'Claude Code' : authStatus.loggedIn ? friendlyApiProvider(authStatus.apiProvider) : '未登录'}
            </div>
            <div className="text-xs text-text-tertiary truncate">
              {authStatus?.loggedIn ? friendlyAuthMethod(authStatus.authMethod) : ''}
            </div>
          </div>
        </button>
      </div>
    </aside>
  );
}
