import { useEffect, useState } from 'react';

const BUILTIN_COMMAND_DESCRIPTIONS: Record<string, string> = {
  clear: '清空当前对话上下文（历史仍保留，可通过 --resume 找回）',
  compact: '压缩对话历史，摘要保留关键上下文',
  context: '查看当前上下文窗口占用情况',
  init: '生成或更新项目的 CLAUDE.md',
  review: '审查一个 GitHub PR',
  'security-review': '对当前改动做一次安全审查',
  agents: '查看可用的子代理',
  config: '查看或修改 CLI 配置',
  usage: '查看用量与计费统计',
};

interface SlashCommandMenuProps {
  open: boolean;
  items: string[];
  highlightedIndex: number;
  onSelect: (name: string) => void;
}

export function SlashCommandMenu({ open, items, highlightedIndex, onSelect }: SlashCommandMenuProps) {
  const [catalogDescriptions, setCatalogDescriptions] = useState<Record<string, string>>({});

  useEffect(() => {
    window.electronAPI.claude
      .loadPluginCatalog()
      .then(({ catalog }) => {
        const map: Record<string, string> = {};
        for (const p of [
          ...catalog.officialSkills,
          ...catalog.personalSkills,
          ...catalog.connectors,
          ...catalog.thirdPartyPlugins,
        ]) {
          if (p.description) map[p.name] = p.description;
        }
        setCatalogDescriptions(map);
      })
      .catch(() => {});
  }, []);

  if (!open || items.length === 0) return null;

  return (
    <div
      data-testid="slash-command-menu"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-80 overflow-y-auto bg-[#2a2a2c] border border-card-border rounded-xl shadow-xl z-50 py-1"
    >
      {items.map((name, i) => {
        const desc = catalogDescriptions[name] ?? BUILTIN_COMMAND_DESCRIPTIONS[name];
        return (
          <button
            key={name}
            data-testid={`slash-command-item-${name}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(name);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
              i === highlightedIndex ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
          >
            <span className="text-neutral-200 font-mono shrink-0">/{name}</span>
            {desc && <span className="text-xs text-text-secondary truncate">{desc}</span>}
          </button>
        );
      })}
    </div>
  );
}
