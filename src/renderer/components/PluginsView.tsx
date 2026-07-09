import { useEffect, useState } from 'react';
import {
  Search,
  Settings,
  SlidersHorizontal,
  Plus,
  ChevronDown,
} from 'lucide-react';
import type { CatalogPlugin, ConnectorPlugin, CustomMcpServer, PluginCatalog, ThirdPartyPlugin } from '../../shared/ipc';

type PluginTab = 'connectors' | 'plugins' | 'skills';
type SkillFilter = 'official' | 'installed' | 'personal';
type ConnectorFilter = 'official' | 'installed' | 'featured' | 'personal';
type PluginFilter = 'official' | 'installed';

const PALETTE = [
  '#5E6AD2', '#0F9D58', '#D93025', '#4285F4', '#9C27B0',
  '#FF6D00', '#00BCD4', '#34A853', '#E34F26', '#0052CC', '#4A154B', '#607D8B',
];

interface FeaturedMcpServer {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
}

// CCodeBox's own curated picks — not derived from any CLI call, unlike everything
// else in this file. Kept as a small hardcoded list rather than a data file since
// there's currently exactly one entry and no mechanism (or need) to manage this
// list at runtime.
const FEATURED_MCP_SERVERS: FeaturedMcpServer[] = [
  {
    id: 'playwright',
    name: 'Playwright',
    description: '让 Claude Code 直接操作浏览器：点击、填表、截图、读取页面内容',
    command: 'npx',
    args: ['@playwright/mcp@latest'],
  },
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
  const [connectorFilter, setConnectorFilter] = useState<ConnectorFilter>('official');
  const [pluginFilter, setPluginFilter] = useState<PluginFilter>('official');
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

  async function handleAddFeatured(server: FeaturedMcpServer) {
    setPendingIds((prev) => new Set(prev).add(server.id));
    setErrorById(({ [server.id]: _drop, ...rest }) => rest);
    const result = await window.electronAPI.claude.addMcpServer({
      name: server.id,
      command: server.command,
      args: server.args,
    });
    if (result.ok) {
      await refreshCatalog();
    } else {
      setErrorById((prev) => ({ ...prev, [server.id]: result.message }));
    }
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(server.id);
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

  const installedSkills = catalog.officialSkills.filter((p) => p.installed);
  const skillList =
    skillFilter === 'official'
      ? catalog.officialSkills
      : skillFilter === 'installed'
        ? installedSkills
        : catalog.personalSkills;

  const filteredConnectors = catalog.connectors.filter((p) => matchesSearch(p.name, p.description, searchQuery));
  const filteredInstalledConnectors = filteredConnectors.filter((p) => p.installed);
  const filteredSkills = skillList.filter((p) => matchesSearch(p.name, p.description, searchQuery));
  const filteredThirdParty = catalog.thirdPartyPlugins.filter((p) => matchesSearch(p.name, p.description, searchQuery));
  const filteredInstalledThirdParty = filteredThirdParty.filter((p) => p.installed);
  const filteredFeatured = FEATURED_MCP_SERVERS.filter((s) => matchesSearch(s.name, s.description, searchQuery));

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
            onClick={() => setActiveTab('plugins')}
            className={`text-sm font-medium transition-colors ${activeTab === 'plugins' ? 'text-white' : 'text-text-secondary hover:text-neutral-300'}`}
          >
            插件
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
            {activeTab === 'connectors' ? '连接器' : activeTab === 'plugins' ? '插件' : '技能'}
          </h1>
          <p className="text-sm text-text-secondary mb-6">
            {activeTab === 'connectors'
              ? '通过 MCP 服务器扩展 Claude Code 的能力'
              : activeTab === 'plugins'
                ? '来自第三方 Claude Code 插件市场（通过 claude plugin marketplace add 添加）'
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
              placeholder={activeTab === 'connectors' ? '搜索连接器...' : activeTab === 'plugins' ? '搜索插件...' : '搜索技能...'}
              className="w-full bg-card border border-card-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-text-secondary outline-none focus:border-neutral-500 transition-colors"
            />
          </div>

          {/* Connector filter tabs */}
          {activeTab === 'connectors' && (
            <div className="flex items-center gap-1 mb-6">
              <button
                onClick={() => setConnectorFilter('official')}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${connectorFilter === 'official' ? 'bg-white/10 text-white' : 'text-text-secondary hover:text-neutral-300 hover:bg-white/5'}`}
              >
                官方
              </button>
              <button
                onClick={() => setConnectorFilter('installed')}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${connectorFilter === 'installed' ? 'bg-white/10 text-white' : 'text-text-secondary hover:text-neutral-300 hover:bg-white/5'}`}
              >
                已安装
              </button>
              <button
                onClick={() => setConnectorFilter('featured')}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${connectorFilter === 'featured' ? 'bg-white/10 text-white' : 'text-text-secondary hover:text-neutral-300 hover:bg-white/5'}`}
              >
                精选
              </button>
              <button
                onClick={() => setConnectorFilter('personal')}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${connectorFilter === 'personal' ? 'bg-white/10 text-white' : 'text-text-secondary hover:text-neutral-300 hover:bg-white/5'}`}
              >
                个人
              </button>
              <div className="flex-1" />
              <button className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-text-secondary">
                <SlidersHorizontal size={14} />
              </button>
            </div>
          )}

          {/* Plugin filter tabs */}
          {activeTab === 'plugins' && (
            <div className="flex items-center gap-1 mb-6">
              <button
                onClick={() => setPluginFilter('official')}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${pluginFilter === 'official' ? 'bg-white/10 text-white' : 'text-text-secondary hover:text-neutral-300 hover:bg-white/5'}`}
              >
                官方
              </button>
              <button
                onClick={() => setPluginFilter('installed')}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${pluginFilter === 'installed' ? 'bg-white/10 text-white' : 'text-text-secondary hover:text-neutral-300 hover:bg-white/5'}`}
              >
                已安装
              </button>
              <div className="flex-1" />
              <button className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-text-secondary">
                <SlidersHorizontal size={14} />
              </button>
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
                onClick={() => setSkillFilter('installed')}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${skillFilter === 'installed' ? 'bg-white/10 text-white' : 'text-text-secondary hover:text-neutral-300 hover:bg-white/5'}`}
              >
                已安装
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
            connectorFilter === 'official' ? (
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
            ) : connectorFilter === 'installed' ? (
              filteredInstalledConnectors.length === 0 ? (
                <div className="text-sm text-text-secondary py-8 text-center border border-dashed border-card-border rounded-xl">
                  还没有已安装的连接器
                </div>
              ) : (
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-white">已安装</h2>
                  <p className="text-xs text-text-secondary mt-0.5 mb-4">
                    通过 claude plugin install 安装的连接器
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {filteredInstalledConnectors.map((plugin) => (
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
              )
            ) : connectorFilter === 'featured' ? (
              <div className="mb-4">
                <h2 className="text-base font-semibold text-white">精选推荐</h2>
                <p className="text-xs text-text-secondary mt-0.5 mb-4">
                  CCodeBox 精选的实用 MCP 服务器
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {filteredFeatured.map((server) => (
                    <FeaturedMcpCard
                      key={server.id}
                      server={server}
                      installed={
                        catalog.customMcpServers.some((s) => s.name === server.id) ||
                        catalog.connectors.some(
                          (c) => c.name === server.id && (c.installed || c.configuredOutsidePlugin),
                        )
                      }
                      pending={pendingIds.has(server.id)}
                      error={errorById[server.id]}
                      onAdd={() => handleAddFeatured(server)}
                    />
                  ))}
                </div>
              </div>
            ) : catalog.customMcpServers.length === 0 ? (
              <div className="text-sm text-text-secondary py-8 text-center border border-dashed border-card-border rounded-xl">
                还没有直接配置的 MCP 服务器
              </div>
            ) : (
              <div className="mb-4">
                <h2 className="text-base font-semibold text-white">个人配置</h2>
                <p className="text-xs text-text-secondary mt-0.5 mb-4">
                  直接通过 claude mcp add 配置的 MCP 服务器
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {catalog.customMcpServers.map((server) => (
                    <PersonalMcpCard key={server.name} server={server} />
                  ))}
                </div>
              </div>
            )
          ) : activeTab === 'plugins' ? (
            pluginFilter === 'installed' ? (
              filteredInstalledThirdParty.length === 0 ? (
                <div className="text-sm text-text-secondary py-8 text-center border border-dashed border-card-border rounded-xl">
                  还没有已安装的插件
                </div>
              ) : (
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-white">已安装</h2>
                  <div className="grid grid-cols-2 gap-3">
                    {filteredInstalledThirdParty.map((plugin) => (
                      <ThirdPartyPluginCard
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
              )
            ) : catalog.thirdPartyPlugins.length === 0 ? (
              <div className="text-sm text-text-secondary py-8 text-center border border-dashed border-card-border rounded-xl">
                {'还没有第三方插件市场。可以在终端里运行 claude plugin marketplace add <owner>/<repo> 添加一个新市场，添加后这里会自动显示其中的插件。'}
              </div>
            ) : (
              <div className="mb-4">
                <h2 className="text-base font-semibold text-white">第三方插件</h2>
                <div className="grid grid-cols-2 gap-3">
                  {filteredThirdParty.map((plugin) => (
                    <ThirdPartyPluginCard
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
            )
          ) : filteredSkills.length > 0 ? (
            <div className="mb-4">
              <h2 className="text-base font-semibold text-white">
                {skillFilter === 'official'
                  ? '官方目录'
                  : skillFilter === 'installed'
                    ? '已安装'
                    : '个人技能'}
              </h2>
              <p className="text-xs text-text-secondary mt-0.5 mb-4">
                {skillFilter === 'official'
                  ? '来自 Claude Code 官方插件市场，按安装量排序 — 非人工精选'
                  : skillFilter === 'installed'
                    ? '通过 claude plugin install 安装的官方技能'
                    : '存放于 ~/.claude/skills，随 Claude Code 自动生效'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {filteredSkills.map((plugin) => (
                  <SkillCard
                    key={plugin.id}
                    plugin={plugin}
                    manageable={skillFilter === 'official' || skillFilter === 'installed'}
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
                : skillFilter === 'installed'
                  ? '还没有已安装的技能'
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
      {plugin.configuredOutsidePlugin ? (
        <span
          className="text-xs text-neutral-400 px-3 py-1.5 shrink-0"
          title="已通过 claude mcp add 等方式直接配置。如需通过插件市场安装管理，请先在终端运行 claude mcp remove 移除现有配置"
        >
          已直接配置
        </span>
      ) : (
        <InstallButton installed={plugin.installed} pending={pending} onInstall={onInstall} onUninstall={onUninstall} />
      )}
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

function ThirdPartyPluginCard({ plugin, pending, error, onInstall, onUninstall }: { plugin: ThirdPartyPlugin } & InstallActionProps) {
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
        <div className="text-[11px] text-text-tertiary truncate mt-0.5">来自 {plugin.marketplace}</div>
        {error && <div className="text-xs text-red-400 truncate mt-0.5">{error}</div>}
      </div>
      <InstallButton installed={plugin.installed} pending={pending} onInstall={onInstall} onUninstall={onUninstall} />
    </div>
  );
}

function FeaturedMcpCard({
  server,
  installed,
  pending,
  error,
  onAdd,
}: {
  server: FeaturedMcpServer;
  installed: boolean;
  pending: boolean;
  error?: string;
  onAdd: () => void;
}) {
  return (
    <div className="border border-card-border rounded-xl p-4 flex items-center gap-3 hover:bg-white/3 transition-colors">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0"
        style={{ backgroundColor: colorForName(server.name) }}
      >
        {initials(server.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-neutral-200">{server.name}</div>
        <div className="text-xs text-text-secondary truncate">{server.description}</div>
        {error && <div className="text-xs text-red-400 truncate mt-0.5">{error}</div>}
      </div>
      {installed ? (
        <span className="text-xs text-green-400 px-3 py-1.5 shrink-0">已添加</span>
      ) : (
        <button
          onClick={onAdd}
          disabled={pending}
          className="text-xs text-white bg-[#363638] hover:bg-[#444446] px-3 py-1.5 rounded-lg transition-colors shrink-0 disabled:opacity-50"
        >
          {pending ? '添加中...' : '添加'}
        </button>
      )}
    </div>
  );
}

function PersonalMcpCard({ server }: { server: CustomMcpServer }) {
  return (
    <div className="border border-card-border rounded-xl p-4 flex items-center gap-3">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0"
        style={{ backgroundColor: colorForName(server.name) }}
      >
        {initials(server.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-neutral-200">{server.name}</div>
      </div>
      <span className="text-xs text-green-400 px-3 py-1.5 shrink-0">已配置</span>
    </div>
  );
}
