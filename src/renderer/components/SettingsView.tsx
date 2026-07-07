import { useEffect, useState } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { EFFORT_LEVELS, EFFORT_LEVEL_LABELS, EFFORT_DEFAULT_LABEL, effortLabel } from '../lib/effortLabels';
import type {
  McpServerSummary,
  EffortLevel,
  PermissionMode,
  UsageStats,
  DailyUsageEntry,
  PermissionsConfig,
  HooksConfig,
  RunDoctorResponse,
  GitStatusResponse,
  GitWorktreesResponse,
  EnvVarSummary,
} from '../../shared/ipc';
import {
  ArrowLeft,
  Search,
  Settings,
  User,
  Sun,
  Wrench,
  Keyboard,
  BarChart3,
  Plug,
  Globe,
  Webhook,
  GitBranch,
  Terminal,
  FolderTree,
  Archive,
  ChevronDown,
  ShieldCheck,
  ShieldAlert,
  Check,
} from 'lucide-react';

type SettingsSection = 'general' | 'profile' | 'appearance' | 'config' | 'shortcuts' | 'usage' | 'mcp' | 'connections' | 'hooks' | 'git' | 'env' | 'worktrees' | 'archived';

// Sections backed by real Claude Code CLI / on-disk data. Everything else still hits
// PlaceholderSection — those are Codex-only concepts (connections/appearance/shortcuts as
// account+theme+keybinding config, archived conversations) with no CLI-side analog, or
// genuinely out of scope for this pass, and are left as an honest "coming soon" rather
// than backed by fabricated data.
const REAL_SECTIONS: SettingsSection[] = ['general', 'profile', 'appearance', 'config', 'mcp', 'hooks', 'usage', 'git', 'worktrees', 'env'];

interface SidebarItem {
  id: SettingsSection;
  label: string;
  icon: typeof Settings;
}

interface SidebarGroup {
  title: string;
  items: SidebarItem[];
}

const sidebarGroups: SidebarGroup[] = [
  {
    title: '个人',
    items: [
      { id: 'general', label: '常规', icon: Settings },
      { id: 'profile', label: '个人资料', icon: User },
      { id: 'appearance', label: '外观', icon: Sun },
      { id: 'config', label: '配置', icon: Wrench },
      { id: 'shortcuts', label: '键盘快捷键', icon: Keyboard },
      { id: 'usage', label: '使用情况和计费', icon: BarChart3 },
    ],
  },
  {
    title: '集成',
    items: [
      { id: 'mcp', label: 'MCP 服务器', icon: Plug },
      { id: 'connections', label: '连接', icon: Globe },
    ],
  },
  {
    title: '编码',
    items: [
      { id: 'hooks', label: '钩子', icon: Webhook },
      { id: 'git', label: 'Git', icon: GitBranch },
      { id: 'env', label: '环境', icon: Terminal },
      { id: 'worktrees', label: '工作树', icon: FolderTree },
    ],
  },
  {
    title: '已归档',
    items: [
      { id: 'archived', label: '已归档对话', icon: Archive },
    ],
  },
];

interface SettingsViewProps {
  onBack: () => void;
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="flex-1 bg-main-bg flex rounded-tl-xl overflow-hidden">
      {/* Settings sidebar */}
      <div className="w-72 bg-sidebar border-r border-card-border flex flex-col shrink-0">
        {/* Back button */}
        <div className="h-[52px] flex items-center pl-20 pr-4 drag">
          <button
            onClick={onBack}
            className="no-drag flex items-center gap-2 text-sm text-text-secondary hover:text-neutral-300 transition-colors"
          >
            <ArrowLeft size={16} />
            返回应用
          </button>
        </div>

        {/* Search */}
        <div className="px-3 mb-4">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索设置..."
              className="w-full bg-[#2a2a2c] rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-neutral-600 transition"
            />
          </div>
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto px-3 space-y-4">
          {sidebarGroups.map((group) => (
            <div key={group.title}>
              <div className="text-xs text-text-tertiary font-medium px-2 mb-1">
                {group.title}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                      activeSection === item.id
                        ? 'bg-white/8 text-white'
                        : 'text-neutral-300 hover:bg-white/5'
                    }`}
                  >
                    <item.icon size={16} strokeWidth={1.8} />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-[700px] mx-auto">
          {activeSection === 'general' && <GeneralSettings />}
          {activeSection === 'profile' && <ProfileSettings />}
          {activeSection === 'appearance' && <AppearanceSettings />}
          {activeSection === 'config' && <ConfigSettings />}
          {activeSection === 'mcp' && <McpSettings />}
          {activeSection === 'hooks' && <HooksSettings />}
          {activeSection === 'usage' && <UsageSettings />}
          {activeSection === 'git' && <GitSettings />}
          {activeSection === 'worktrees' && <WorktreesSettings />}
          {activeSection === 'env' && <EnvSettings />}
          {!REAL_SECTIONS.includes(activeSection) && (
            <PlaceholderSection title={sidebarGroups.flatMap(g => g.items).find(i => i.id === activeSection)?.label || ''} />
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-bold text-white">{title}</h1>
      {description && <p className="text-sm text-text-secondary mt-1">{description}</p>}
    </div>
  );
}

function SettingCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-card-border rounded-xl divide-y divide-card-border">
      {children}
    </div>
  );
}

function SettingRow({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div className="min-w-0 flex-1 mr-4">
        <div className="text-sm text-neutral-200 font-medium">{title}</div>
        {description && <div className="text-xs text-text-secondary mt-0.5 leading-relaxed">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

interface DropdownOption {
  value: string;
  label: string;
}

function SelectDropdown({ value, options, onSelect }: { value: string; options: DropdownOption[]; onSelect?: (value: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-sm text-neutral-300 bg-[#363638] hover:bg-[#444446] px-3 py-1.5 rounded-lg transition-colors"
      >
        {value}
        <ChevronDown size={14} className="text-text-secondary" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-56 max-h-72 overflow-y-auto bg-[#2a2a2c] border border-card-border rounded-xl shadow-xl z-50 py-1">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onSelect?.(opt.value);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5 transition-colors"
              >
                {opt.label === value ? <Check size={14} className="text-accent-amber shrink-0" /> : <span className="w-3.5 shrink-0" />}
                <span className="truncate">{opt.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const effortOptions: DropdownOption[] = [
  { value: '', label: EFFORT_DEFAULT_LABEL },
  ...EFFORT_LEVELS.map((level) => ({ value: level, label: EFFORT_LEVEL_LABELS[level] })),
];

function GeneralSettings() {
  const permissionMode = useSessionStore((s) => s.permissionMode);
  const setPermissionMode = useSessionStore((s) => s.setPermissionMode);
  const effortLevel = useSessionStore((s) => s.effortLevel);
  const setEffortLevel = useSessionStore((s) => s.setEffortLevel);
  const modelProviders = useSessionStore((s) => s.modelProviders);
  const selectedProviderId = useSessionStore((s) => s.selectedProviderId);
  const selectedModelId = useSessionStore((s) => s.selectedModelId);
  const setSelectedModel = useSessionStore((s) => s.setSelectedModel);

  const selectedProvider = modelProviders.find((p) => p.id === selectedProviderId);
  const selectedModelLabel = selectedProvider?.models.find((m) => m.id === selectedModelId)?.label ?? selectedModelId;
  const modelOptions: DropdownOption[] = modelProviders.flatMap((p) =>
    p.models.map((m) => ({
      value: `${p.id}::${m.id}`,
      label: modelProviders.length > 1 ? `${p.name} · ${m.label}` : m.label,
    }))
  );

  return (
    <>
      <SectionTitle title="常规" description="以下设置应用于下一个新建的对话，不影响已经开始的会话" />

      <h3 className="text-sm font-semibold text-white mb-3">权限模式</h3>
      <p className="text-xs text-text-secondary mb-3">对应 claude 的 --permission-mode 参数</p>
      <div className="grid grid-cols-2 gap-3 mb-8">
        <button
          onClick={() => setPermissionMode('bypassPermissions')}
          className={`rounded-xl p-4 text-left transition-colors border-2 ${
            permissionMode === 'bypassPermissions' ? 'border-accent' : 'border-card-border hover:bg-white/3'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <ShieldCheck size={18} className="text-neutral-300" />
            <div
              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                permissionMode === 'bypassPermissions' ? 'bg-accent border-accent' : 'border-neutral-600'
              }`}
            >
              {permissionMode === 'bypassPermissions' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
            </div>
          </div>
          <div className="text-sm font-medium text-white">完全访问</div>
          <div className="text-xs text-text-secondary mt-0.5">无需批准即可编辑文件、运行命令</div>
        </button>
        <button
          onClick={() => setPermissionMode('default')}
          className={`rounded-xl p-4 text-left transition-colors border-2 ${
            permissionMode === 'default' ? 'border-accent' : 'border-card-border hover:bg-white/3'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <ShieldAlert size={18} className="text-neutral-300" />
            <div
              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                permissionMode === 'default' ? 'bg-accent border-accent' : 'border-neutral-600'
              }`}
            >
              {permissionMode === 'default' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
            </div>
          </div>
          <div className="text-sm font-medium text-white">默认权限</div>
          <div className="text-xs text-text-secondary mt-0.5">需要额外访问权限时会先请求你的批准</div>
        </button>
      </div>

      <h3 className="text-sm font-semibold text-white mb-3">新对话默认值</h3>
      <SettingCard>
        <SettingRow title="默认模型" description="新建对话时使用的模型">
          <SelectDropdown
            value={selectedModelLabel}
            options={modelOptions}
            onSelect={(key) => {
              const [providerId, modelId] = key.split('::');
              setSelectedModel(providerId, modelId);
            }}
          />
        </SettingRow>
        <SettingRow title="推理强度" description="对应 --effort 参数；留空则使用 CLI 自身默认值（可能来自 CLAUDE_CODE_EFFORT_LEVEL 环境变量）">
          <SelectDropdown
            value={effortLabel(effortLevel)}
            options={effortOptions}
            onSelect={(key) => setEffortLevel(key === '' ? null : (key as EffortLevel))}
          />
        </SettingRow>
      </SettingCard>
    </>
  );
}

type AccentTheme = 'black' | 'lake-blue';

const THEME_STORAGE_KEY = 'ccodebox:theme';

function AppearanceSettings() {
  const [theme, setTheme] = useState<AccentTheme>(() => {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'lake-blue' ? 'lake-blue' : 'black';
  });

  const applyTheme = (next: AccentTheme) => {
    setTheme(next);
    if (next === 'black') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(THEME_STORAGE_KEY, next);
    }
  };

  const options: { id: AccentTheme; label: string; swatch: string }[] = [
    { id: 'black', label: '主黑色', swatch: '#1c1c1e' },
    { id: 'lake-blue', label: '主湖水宝蓝色', swatch: '#0ea5e9' },
  ];

  return (
    <>
      <SectionTitle title="外观" description="选择界面的强调色主题" />
      <div className="grid grid-cols-3 gap-3">
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => applyTheme(opt.id)}
            className={`rounded-xl p-4 text-left transition-colors border-2 ${
              theme === opt.id ? 'border-accent' : 'border-card-border hover:bg-white/3'
            }`}
          >
            <div className="w-8 h-8 rounded-full border border-white/10 mb-3" style={{ backgroundColor: opt.swatch }} />
            <div className="text-sm font-medium text-white">{opt.label}</div>
          </button>
        ))}
        <div className="rounded-xl p-4 text-left border-2 border-card-border opacity-50 cursor-not-allowed">
          <div className="w-8 h-8 rounded-full border border-white/10 mb-3" style={{ backgroundColor: '#f5f5f5' }} />
          <div className="text-sm font-medium text-white">主白色</div>
          <div className="text-xs text-text-secondary mt-1">
            完整浅色主题涉及原生玻璃质感与强制深色渲染的架构调整，暂未开放
          </div>
        </div>
      </div>
    </>
  );
}

function useUsageStats() {
  const [stats, setStats] = useState<UsageStats | null>(null);

  useEffect(() => {
    window.electronAPI.claude.getUsageStats().then(({ stats }) => setStats(stats));
  }, []);

  return stats;
}

function UsageHeatmap({ dailyUsage, peakDayTokens }: { dailyUsage: DailyUsageEntry[]; peakDayTokens: number }) {
  const tokensByDate = new Map(dailyUsage.map((d) => [d.date, d.tokens]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Anchor the grid's last column to the end of the current week (Saturday) so full weeks
  // stack as complete columns, then walk back 53*7 days for a GitHub-style 371-day span.
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + (6 - today.getDay()));
  const totalDays = 53 * 7;
  const start = new Date(endOfWeek);
  start.setDate(endOfWeek.getDate() - (totalDays - 1));

  const days: { key: string; date: Date; tokens: number }[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const date = String(d.getDate()).padStart(2, '0');
    const key = `${d.getFullYear()}-${month}-${date}`;
    days.push({ key, date: d, tokens: tokensByDate.get(key) ?? 0 });
  }

  const weeks: { key: string; date: Date; tokens: number }[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const levelClass = (tokens: number) => {
    if (tokens === 0 || peakDayTokens <= 0) return 'bg-white/5';
    const level = Math.min(4, Math.ceil((tokens / peakDayTokens) * 4));
    return ['bg-heat-1', 'bg-heat-2', 'bg-heat-3', 'bg-accent-orange'][level - 1];
  };

  return (
    <div>
      <div className="flex gap-[3px] overflow-x-auto pb-2">
        {weeks.map((week) => (
          <div key={week[0].key} className="flex flex-col gap-[3px]">
            {week.map((day) => (
              <div
                key={day.key}
                tabIndex={0}
                aria-label={`${day.date.getFullYear()}年${day.date.getMonth() + 1}月${day.date.getDate()}日 · ${day.tokens.toLocaleString()} tokens`}
                title={`${day.date.getFullYear()}年${day.date.getMonth() + 1}月${day.date.getDate()}日 · ${day.tokens.toLocaleString()} tokens`}
                className={`w-[11px] h-[11px] rounded-sm ${levelClass(day.tokens)} focus:outline focus:outline-1 focus:outline-neutral-400`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 mt-2 text-xs text-text-tertiary">
        <span>少</span>
        <div className="w-[11px] h-[11px] rounded-sm bg-white/5" />
        <div className="w-[11px] h-[11px] rounded-sm bg-heat-1" />
        <div className="w-[11px] h-[11px] rounded-sm bg-heat-2" />
        <div className="w-[11px] h-[11px] rounded-sm bg-heat-3" />
        <div className="w-[11px] h-[11px] rounded-sm bg-accent-orange" />
        <span>多</span>
      </div>
    </div>
  );
}

function ProfileSettings() {
  const stats = useUsageStats();

  return (
    <>
      <SectionTitle title="个人资料" description="基于本机 ~/.claude/projects 会话记录统计，而非云端账户数据" />

      {stats === null ? (
        <p className="text-sm text-text-secondary">正在读取...</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3 mb-8">
            {[
              { value: stats.totalTokens.toLocaleString(), label: '累计 Token 数' },
              { value: stats.peakDayTokens.toLocaleString(), label: '峰值 Token 数' },
              { value: String(stats.currentStreakDays), label: '当前连续天数' },
              { value: String(stats.longestStreakDays), label: '最长连续天数' },
            ].map((stat) => (
              <div key={stat.label} className="bg-card border border-card-border rounded-xl p-3 text-center">
                <div className="text-lg font-semibold text-white">{stat.value}</div>
                <div className="text-xs text-text-secondary mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>

          <h3 className="text-sm font-semibold text-white mb-3">活动洞察</h3>
          <SettingCard>
            <SettingRow title="已探索的技能" description="~/.claude.json 的 skillUsage 中记录的不同技能数">
              <span className="text-sm text-neutral-300">{stats.skillsExploredCount}</span>
            </SettingRow>
            <SettingRow title="技能调用总数" description="所有技能的调用次数之和">
              <span className="text-sm text-neutral-300">{stats.totalSkillUsageCount}</span>
            </SettingRow>
            <SettingRow title="会话总数" description="~/.claude/projects 下的会话记录文件数">
              <span className="text-sm text-neutral-300">{stats.totalSessions}</span>
            </SettingRow>
            <SettingRow title="项目总数" description="~/.claude/projects 下的项目目录数">
              <span className="text-sm text-neutral-300">{stats.totalProjects}</span>
            </SettingRow>
          </SettingCard>

          {stats.topSkills.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-white mt-8 mb-3">最常用的技能</h3>
              <SettingCard>
                {stats.topSkills.map((skill) => (
                  <SettingRow
                    key={skill.name}
                    title={skill.name}
                    description={skill.lastUsedAt ? `最后使用于 ${new Date(skill.lastUsedAt).toLocaleDateString()}` : undefined}
                  >
                    <span className="text-sm text-neutral-300">{skill.usageCount} 次</span>
                  </SettingRow>
                ))}
              </SettingCard>
            </>
          )}

          <h3 className="text-sm font-semibold text-white mt-8 mb-3">活动热力图</h3>
          <UsageHeatmap dailyUsage={stats.dailyUsage} peakDayTokens={stats.peakDayTokens} />
        </>
      )}
    </>
  );
}

function ConfigSettings() {
  const cwd = useSessionStore((s) => s.selectedProjectCwd);
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [permissions, setPermissions] = useState<PermissionsConfig | null>(null);
  const [claudeMdMissing, setClaudeMdMissing] = useState(false);
  const [doctorState, setDoctorState] = useState<'idle' | 'running' | 'done'>('idle');
  const [doctorResult, setDoctorResult] = useState<RunDoctorResponse | null>(null);

  useEffect(() => {
    window.electronAPI.claude.getClaudeVersion().then(({ version }) => setVersion(version));
  }, []);

  useEffect(() => {
    if (!cwd) return;
    setPermissions(null);
    window.electronAPI.claude.getProjectSettings({ cwd }).then(({ permissions }) => setPermissions(permissions));
  }, [cwd]);

  const handleOpenClaudeMd = async () => {
    if (!cwd) return;
    const { exists } = await window.electronAPI.claude.openClaudeMd({ cwd });
    setClaudeMdMissing(!exists);
  };

  const handleRunDoctor = async () => {
    if (!cwd) return;
    setDoctorState('running');
    const result = await window.electronAPI.claude.runDoctor({ cwd });
    setDoctorResult(result);
    setDoctorState('done');
  };

  if (!cwd) {
    return (
      <>
        <SectionTitle title="配置" />
        <p className="text-sm text-text-secondary">请先在主界面选择一个项目</p>
      </>
    );
  }

  return (
    <>
      <SectionTitle title="配置" description="当前项目的权限规则与 CLI 环境信息" />

      <h3 className="text-sm font-semibold text-white mb-3">权限规则</h3>
      <p className="text-xs text-text-secondary mb-3">
        合并自 ~/.claude/settings.json、项目 .claude/settings.json 与 .claude/settings.local.json
      </p>
      {permissions === null ? (
        <p className="text-sm text-text-secondary">正在读取...</p>
      ) : (
        <SettingCard>
          <SettingRow title="允许" description={permissions.allow.length ? permissions.allow.join(', ') : '未设置，使用 CLI 默认行为'}>
            <span className="text-sm text-neutral-300">{permissions.allow.length} 条规则</span>
          </SettingRow>
          <SettingRow title="需要确认" description={permissions.ask.length ? permissions.ask.join(', ') : '无'}>
            <span className="text-sm text-neutral-300">{permissions.ask.length} 条规则</span>
          </SettingRow>
          <SettingRow title="拒绝" description={permissions.deny.length ? permissions.deny.join(', ') : '无'}>
            <span className="text-sm text-neutral-300">{permissions.deny.length} 条规则</span>
          </SettingRow>
        </SettingCard>
      )}

      <h3 className="text-sm font-semibold text-white mt-8 mb-3">工作空间</h3>
      <SettingCard>
        <SettingRow title="当前版本" description="claude --version">
          <span className="text-sm text-neutral-300">{version === undefined ? '检测中...' : version ?? '无法检测'}</span>
        </SettingRow>
        <SettingRow title="CLAUDE.md" description={claudeMdMissing ? '当前项目未找到 CLAUDE.md' : '项目级别的自定义指令文件'}>
          <button onClick={handleOpenClaudeMd} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
            打开编辑器
          </button>
        </SettingRow>
        <SettingRow title="诊断" description="运行 claude doctor 检查当前工作空间">
          <button
            onClick={handleRunDoctor}
            disabled={doctorState === 'running'}
            className="flex items-center gap-1.5 text-xs text-neutral-300 bg-[#363638] hover:bg-[#444446] disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Search size={12} />
            {doctorState === 'running' ? '运行中...' : '诊断'}
          </button>
        </SettingRow>
      </SettingCard>

      {doctorResult && (
        <div className="mt-4">
          <div className={`text-xs mb-2 ${doctorResult.ok ? 'text-green-400' : 'text-red-400'}`}>
            {doctorResult.ok ? '诊断完成' : '诊断命令返回了错误'}
          </div>
          <pre className="bg-card border border-card-border rounded-xl p-4 text-xs text-neutral-300 whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
            {doctorResult.output || '（无输出）'}
          </pre>
        </div>
      )}
    </>
  );
}

function McpSettings() {
  const [servers, setServers] = useState<McpServerSummary[] | null>(null);

  useEffect(() => {
    window.electronAPI.claude.listMcpServers().then(({ servers }) => setServers(servers));
  }, []);

  return (
    <>
      <SectionTitle title="MCP 服务器" description="管理已配置的 MCP 服务器（读取自 ~/.claude.json）" />

      {servers === null ? (
        <p className="text-sm text-text-secondary">正在读取...</p>
      ) : servers.length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl p-8 text-center">
          <p className="text-sm text-text-secondary">还没有配置任何 MCP 服务器</p>
        </div>
      ) : (
        <SettingCard>
          {servers.map((server) => (
            <SettingRow key={server.name} title={server.name} description={`状态：已配置 · 类型 ${server.type}`}>
              <span className="text-xs text-green-400">已配置</span>
            </SettingRow>
          ))}
        </SettingCard>
      )}

      <div className="mt-6">
        <button className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors">
          <Plug size={14} />
          添加 MCP 服务器
        </button>
      </div>
    </>
  );
}

function HooksSettings() {
  const cwd = useSessionStore((s) => s.selectedProjectCwd);
  const [hooks, setHooks] = useState<HooksConfig | null>(null);

  useEffect(() => {
    if (!cwd) return;
    setHooks(null);
    window.electronAPI.claude.getProjectSettings({ cwd }).then(({ hooks }) => setHooks(hooks));
  }, [cwd]);

  const events = hooks ? Object.entries(hooks) : [];

  return (
    <>
      <SectionTitle title="钩子" description="合并自 ~/.claude/settings.json 与项目 .claude/settings*.json" />

      {!cwd ? (
        <p className="text-sm text-text-secondary">请先在主界面选择一个项目</p>
      ) : hooks === null ? (
        <p className="text-sm text-text-secondary">正在读取...</p>
      ) : events.length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl p-8 text-center">
          <p className="text-sm text-text-secondary">当前没有配置任何钩子</p>
        </div>
      ) : (
        <SettingCard>
          {events.map(([event, matchers]) => {
            const commandCount = matchers.reduce((sum, m) => sum + m.commands.length, 0);
            const matcherText = matchers.map((m) => m.matcher).filter(Boolean).join(', ');
            return (
              <SettingRow key={event} title={event} description={matcherText || '匹配所有工具'}>
                <span className="text-xs text-text-secondary">{commandCount} 条命令</span>
              </SettingRow>
            );
          })}
        </SettingCard>
      )}
    </>
  );
}

function UsageSettings() {
  const stats = useUsageStats();
  const projects = useSessionStore((s) => s.projects);

  return (
    <>
      <SectionTitle
        title="使用情况和计费"
        description="Claude Code CLI 未提供本地可读取的额度/账单数据；以下为本机会话记录中的 Token 用量统计"
      />

      {stats === null ? (
        <p className="text-sm text-text-secondary">正在读取...</p>
      ) : stats.perProject.length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl p-8 text-center">
          <p className="text-sm text-text-secondary">还没有找到任何本机会话记录</p>
        </div>
      ) : (
        <>
          <h3 className="text-sm font-semibold text-white mb-3">按项目统计 Token 用量</h3>
          <SettingCard>
            {stats.perProject.map((p) => {
              const displayName = projects.find((proj) => proj.cwd === p.cwd)?.displayName ?? p.cwd.split('/').pop() ?? p.cwd;
              return (
                <SettingRow key={p.cwd} title={displayName} description={`${p.sessionCount} 个会话 · ${p.cwd}`}>
                  <span className="text-sm text-neutral-300">{p.totalTokens.toLocaleString()} tokens</span>
                </SettingRow>
              );
            })}
          </SettingCard>
        </>
      )}
    </>
  );
}

function GitSettings() {
  const cwd = useSessionStore((s) => s.selectedProjectCwd);
  const [status, setStatus] = useState<GitStatusResponse | null>(null);

  useEffect(() => {
    if (!cwd) return;
    setStatus(null);
    window.electronAPI.claude.getGitStatus({ cwd }).then(setStatus);
  }, [cwd]);

  if (!cwd) {
    return (
      <>
        <SectionTitle title="Git" />
        <p className="text-sm text-text-secondary">请先在主界面选择一个项目</p>
      </>
    );
  }

  return (
    <>
      <SectionTitle title="Git" description={cwd} />
      {status === null ? (
        <p className="text-sm text-text-secondary">正在读取...</p>
      ) : !status.isRepo ? (
        <div className="bg-card border border-card-border rounded-xl p-8 text-center">
          <p className="text-sm text-text-secondary">当前项目不是一个 Git 仓库</p>
        </div>
      ) : (
        <SettingCard>
          <SettingRow title="当前分支" description="git rev-parse --abbrev-ref HEAD">
            <span className="text-sm text-neutral-300">{status.branch ?? '(detached HEAD)'}</span>
          </SettingRow>
          <SettingRow title="领先/落后远程" description="相对于上游分支">
            <span className="text-sm text-neutral-300">
              {status.ahead === undefined && status.behind === undefined
                ? '未设置上游分支'
                : `+${status.ahead ?? 0} / -${status.behind ?? 0}`}
            </span>
          </SettingRow>
          <SettingRow title="未提交的更改" description="git status --porcelain">
            <span className="text-sm text-neutral-300">{status.dirtyCount ?? 0} 个文件</span>
          </SettingRow>
        </SettingCard>
      )}
    </>
  );
}

function WorktreesSettings() {
  const cwd = useSessionStore((s) => s.selectedProjectCwd);
  const [data, setData] = useState<GitWorktreesResponse | null>(null);

  useEffect(() => {
    if (!cwd) return;
    setData(null);
    window.electronAPI.claude.getGitWorktrees({ cwd }).then(setData);
  }, [cwd]);

  if (!cwd) {
    return (
      <>
        <SectionTitle title="工作树" />
        <p className="text-sm text-text-secondary">请先在主界面选择一个项目</p>
      </>
    );
  }

  return (
    <>
      <SectionTitle title="工作树" description="claude 支持通过 --worktree 在独立工作树中启动会话" />
      {data === null ? (
        <p className="text-sm text-text-secondary">正在读取...</p>
      ) : !data.isRepo ? (
        <div className="bg-card border border-card-border rounded-xl p-8 text-center">
          <p className="text-sm text-text-secondary">当前项目不是一个 Git 仓库</p>
        </div>
      ) : (
        <SettingCard>
          {data.worktrees.map((wt) => (
            <SettingRow key={wt.path} title={wt.path} description={wt.isMain ? '主工作树' : '额外工作树'}>
              <span className="text-sm text-neutral-300">{wt.branch ?? '(detached)'}</span>
            </SettingRow>
          ))}
        </SettingCard>
      )}
    </>
  );
}

function EnvSettings() {
  const [vars, setVars] = useState<EnvVarSummary[] | null>(null);

  useEffect(() => {
    window.electronAPI.claude.getEnvConfig().then(({ vars }) => setVars(vars));
  }, []);

  return (
    <>
      <SectionTitle title="环境" description="~/.claude/settings.json 中配置的 env 键（值已脱敏，不会显示明文）" />

      {vars === null ? (
        <p className="text-sm text-text-secondary">正在读取...</p>
      ) : vars.length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl p-8 text-center">
          <p className="text-sm text-text-secondary">当前没有配置任何环境变量</p>
        </div>
      ) : (
        <SettingCard>
          {vars.map((v) => (
            <SettingRow key={v.key} title={v.key} description="">
              <span className="text-sm text-neutral-300 font-mono">{v.maskedValue}</span>
            </SettingRow>
          ))}
        </SettingCard>
      )}
    </>
  );
}

function PlaceholderSection({ title }: { title: string }) {
  return (
    <>
      <SectionTitle title={title} description="此设置页面即将推出" />
      <div className="bg-card border border-card-border rounded-xl p-8 text-center">
        <p className="text-sm text-text-secondary">设置内容开发中...</p>
      </div>
    </>
  );
}
