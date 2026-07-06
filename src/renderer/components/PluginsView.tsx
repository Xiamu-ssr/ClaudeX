import { useEffect, useState } from 'react';
import {
  Search,
  Settings,
  SlidersHorizontal,
  Plus,
  ChevronDown,
} from 'lucide-react';
import type { CatalogPlugin, ConnectorPlugin, PluginCatalog } from '../../shared/ipc';

type PluginTab = 'connectors' | 'skills';
type SkillFilter = 'official' | 'personal';

const PALETTE = [
  '#5E6AD2', '#0F9D58', '#D93025', '#4285F4', '#9C27B0',
  '#FF6D00', '#00BCD4', '#34A853', '#E34F26', '#0052CC', '#4A154B', '#607D8B',
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function initials(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, ' ').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase() || '??';
}

function matchesSearch(name: string, description: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return name.toLowerCase().includes(q) || description.toLowerCase().includes(q);
}

export function PluginsView() {
  const [activeTab, setActiveTab] = useState<PluginTab>('connectors');
  const [skillFilter, setSkillFilter] = useState<SkillFilter>('official');
  const [searchQuery, setSearchQuery] = useState('');
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  async function refreshCatalog() {
    const { catalog } = await window.electronAPI.claude.loadPluginCatalog();
    setCatalog(catalog);
  }

  useEffect(() => {
    refreshCatalog();
  }, []);

  async function handleInstall(plugin: CatalogPlugin) {
    setPendingIds((prev) => new Set(prev).add(plugin.id));
    setErrorById(({ [plugin.id]: _drop, ...rest }) => rest);
    const result = await window.electronAPI.claude.installPlugin({ pluginId: plugin.id });
    if (result.ok) {
      await refreshCatalog();
    } else {
      setErrorById((prev) => ({ ...prev, [plugin.id]: result.message }));
    }
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(plugin.id);
      return next;
    });
  }

  async function handleUninstall(plugin: CatalogPlugin) {
    setPendingIds((prev) => new Set(prev).add(plugin.id));
    setErrorById(({ [plugin.id]: _drop, ...rest }) => rest);
    const result = await window.electronAPI.claude.uninstallPlugin({ pluginName: plugin.name });
    if (result.ok) {
      await refreshCatalog();
    } else {
      setErrorById((prev) => ({ ...prev, [plugin.id]: result.message }));
    }
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(plugin.id);
      return next;
    });
  }

  if (!catalog) {
    return (
      <div className="flex-1 bg-main-bg flex flex-col rounded-tl-xl overflow-hidden">
        <div className="h-[52px] drag shrink-0" />
        <div className="flex-1 flex items-center justify-center text-sm text-text-secondary">
          正在读取 Claude Code 插件目录...
        </div>
      </div>
    );
  }

  const installedConnectors = catalog.connectors.filter((c) => c.installed);
  const skillList = skillFilter === 'official' ? catalog.officialSkills : catalog.personalSkills;

  const filteredConnectors = catalog.connectors.filter((p) => matchesSearch(p.name, p.description, searchQuery));
  const filteredSkills = skillList.filter((p) => matchesSearch(p.name, p.description, searchQuery));

  return (
    <div className="flex-1 bg-main-bg flex flex-col rounded-tl-xl overflow-hidden">
      {/* Top bar */}
      <div className="h-[52px] flex items-center px-5 drag shrink-0">
        <div className="flex items-center gap-4 no-drag">
          <button
            onClick={() => setActiveTab('connectors')}
            className={`text-sm font-medium transition-colors ${activeTab === 'connectors' ? 'text-white' : 'text-text-secondary hover:text-neutral-300'}`}
          >
            连接器
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            className={`text-sm font-medium transition-colors ${activeTab === 'skills' ? 'text-white' : 'text-text-secondary hover:text-neutral-300'}`}
          >
            技能
          </button>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1 no-drag">
          <button className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-neutral-500 hover:text-neutral-300">
            <Settings size={16} />
          </button>
          <button className="flex items-center gap-1 text-sm text-neutral-300 bg-[#363638] hover:bg-[#444446] pl-2 pr-1.5 py-1 rounded-lg transition-colors">
            <Plus size={14} />
            <ChevronDown size={14} className="text-text-secondary" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-[820px] mx-auto">
          {/* Title */}
          <h1 className="text-2xl font-bold text-white mb-1">
            {activeTab === 'connectors' ? '连接器' : '技能'}
          </h1>
          <p className="text-sm text-text-secondary mb-6">
            {activeTab === 'connectors'
              ? '通过 MCP 服务器扩展 Claude Code 的能力'
              : '可复用的工作流和自动化技能'
            }
          </p>

          {/* Search */}
          <div className="relative mb-6">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={activeTab === 'connectors' ? '搜索连接器...' : '搜索技能...'}
              className="w-full bg-card border border-card-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-text-secondary outline-none focus:border-neutral-500 transition-colors"
            />
          </div>

          {/* Installed section */}
          {activeTab === 'connectors' && (installedConnectors.length > 0 || catalog.customMcpServers.length > 0) && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-white">已安装</h2>
                <button className="p-1 rounded hover:bg-white/5 transition-colors text-text-secondary">
                  <Settings size={14} />
                </button>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {installedConnectors.map((p) => (
                  <div
                    key={p.id}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ backgroundColor: colorForName(p.name) }}
                    title={p.name}
                  >
                    {initials(p.name)}
                  </div>
                ))}
                {catalog.customMcpServers.map((s) => (
                  <div
                    key={s.name}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ backgroundColor: colorForName(s.name) }}
                    title={`${s.name}（自定义 MCP 服务器）`}
                  >
                    {initials(s.name)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skill filter tabs */}
          {activeTab === 'skills' && (
            <div className="flex items-center gap-1 mb-6">
              <button
                onClick={() => setSkillFilter('official')}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${skillFilter === 'official' ? 'bg-white/10 text-white' : 'text-text-secondary hover:text-neutral-300 hover:bg-white/5'}`}
              >
                官方
              </button>
              <button
                onClick={() => setSkillFilter('personal')}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${skillFilter === 'personal' ? 'bg-white/10 text-white' : 'text-text-secondary hover:text-neutral-300 hover:bg-white/5'}`}
              >
                个人
              </button>
              <div className="flex-1" />
              <button className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-text-secondary">
                <SlidersHorizontal size={14} />
              </button>
            </div>
          )}

          {/* Plugin grid */}
          {activeTab === 'connectors' ? (
            <div className="mb-4">
              <h2 className="text-base font-semibold text-white">官方目录</h2>
              <p className="text-xs text-text-secondary mt-0.5 mb-4">
                来自 Claude Code 官方插件市场，按安装量排序 — 非人工精选
              </p>
              <div className="grid grid-cols-2 gap-3">
                {filteredConnectors.map((plugin) => (
                  <ConnectorCard
                    key={plugin.id}
                    plugin={plugin}
                    pending={pendingIds.has(plugin.id)}
                    error={errorById[plugin.id]}
                    onInstall={() => handleInstall(plugin)}
                    onUninstall={() => handleUninstall(plugin)}
                  />
                ))}
              </div>
            </div>
          ) : filteredSkills.length > 0 ? (
            <div className="mb-4">
              <h2 className="text-base font-semibold text-white">
                {skillFilter === 'official' ? '官方目录' : '个人技能'}
              </h2>
              <p className="text-xs text-text-secondary mt-0.5 mb-4">
                {skillFilter === 'official'
                  ? '来自 Claude Code 官方插件市场，按安装量排序 — 非人工精选'
                  : '存放于 ~/.claude/skills，随 Claude Code 自动生效'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {filteredSkills.map((plugin) => (
                  <SkillCard
                    key={plugin.id}
                    plugin={plugin}
                    manageable={skillFilter === 'official'}
                    pending={pendingIds.has(plugin.id)}
                    error={errorById[plugin.id]}
                    onInstall={() => handleInstall(plugin)}
                    onUninstall={() => handleUninstall(plugin)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-sm text-text-secondary py-8 text-center border border-dashed border-card-border rounded-xl">
              {skillFilter === 'personal'
                ? '还没有个人技能，可以在 ~/.claude/skills 下添加'
                : '没有匹配的技能'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface InstallActionProps {
  pending: boolean;
  error?: string;
  onInstall: () => void;
  onUninstall: () => void;
}

// Shared by ConnectorCard and (manageable) SkillCard — installed state comes from a real
// `claude plugin list --json` check (see main/plugins/pluginCatalog.ts), and the actions
// shell real `claude plugin install/uninstall` commands, not local-only UI state.
function InstallButton({ installed, pending, onInstall, onUninstall }: InstallActionProps & { installed: boolean }) {
  const [hovering, setHovering] = useState(false);

  if (!installed) {
    return (
      <button
        onClick={onInstall}
        disabled={pending}
        className="text-xs text-white bg-[#363638] hover:bg-[#444446] px-3 py-1.5 rounded-lg transition-colors shrink-0 disabled:opacity-50"
      >
        {pending ? '安装中...' : '安装'}
      </button>
    );
  }

  return (
    <button
      onClick={onUninstall}
      disabled={pending}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`text-xs px-3 py-1.5 rounded-lg transition-colors shrink-0 disabled:opacity-50 ${
        hovering ? 'text-red-300 bg-red-500/10 hover:bg-red-500/20' : 'text-green-400 bg-transparent'
      }`}
    >
      {pending ? '卸载中...' : hovering ? '卸载' : '已安装'}
    </button>
  );
}

function ConnectorCard({ plugin, pending, error, onInstall, onUninstall }: { plugin: ConnectorPlugin } & InstallActionProps) {
  return (
    <div className="border border-card-border rounded-xl p-4 flex items-center gap-3 hover:bg-white/3 transition-colors">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0"
        style={{ backgroundColor: colorForName(plugin.name) }}
      >
        {initials(plugin.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-neutral-200">{plugin.name}</div>
        <div className="text-xs text-text-secondary truncate">{plugin.description}</div>
        {error && <div className="text-xs text-red-400 truncate mt-0.5">{error}</div>}
      </div>
      <InstallButton installed={plugin.installed} pending={pending} onInstall={onInstall} onUninstall={onUninstall} />
    </div>
  );
}

function SkillCard({
  plugin,
  manageable,
  pending,
  error,
  onInstall,
  onUninstall,
}: { plugin: CatalogPlugin; manageable: boolean } & InstallActionProps) {
  return (
    <div className="border border-card-border rounded-xl p-4 flex items-center gap-3 hover:bg-white/3 transition-colors">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0"
        style={{ backgroundColor: colorForName(plugin.name) }}
      >
        {initials(plugin.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-neutral-200">{plugin.name}</div>
        <div className="text-xs text-text-secondary truncate">{plugin.description}</div>
        {error && <div className="text-xs text-red-400 truncate mt-0.5">{error}</div>}
      </div>
      {manageable && (
        <InstallButton installed={plugin.installed} pending={pending} onInstall={onInstall} onUninstall={onUninstall} />
      )}
    </div>
  );
}
