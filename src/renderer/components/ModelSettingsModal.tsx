import { useState } from 'react';
import { X, Plus, Trash2, Pencil } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import type { ModelProviderConfig } from '../../shared/ipc';

interface ModelSettingsModalProps {
  onClose: () => void;
}

interface EnvRow {
  key: string;
  value: string;
}
interface ModelRow {
  id: string;
  label: string;
  contextWindowTokens: string;
}

interface EditableProvider {
  id: string | null; // null = creating a new provider
  name: string;
  envRows: EnvRow[];
  modelRows: ModelRow[];
}

function emptyEditable(): EditableProvider {
  return {
    id: null,
    name: '',
    envRows: [{ key: '', value: '' }],
    modelRows: [{ id: '', label: '', contextWindowTokens: '' }],
  };
}

function toEditable(provider: ModelProviderConfig): EditableProvider {
  const envEntries = Object.entries(provider.env);
  return {
    id: provider.id,
    name: provider.name,
    envRows: envEntries.length > 0 ? envEntries.map(([key, value]) => ({ key, value })) : [{ key: '', value: '' }],
    modelRows:
      provider.models.length > 0
        ? provider.models.map((m) => ({
            id: m.id,
            label: m.label,
            contextWindowTokens: m.contextWindowTokens ? String(m.contextWindowTokens) : '',
          }))
        : [{ id: '', label: '', contextWindowTokens: '' }],
  };
}

export function ModelSettingsModal({ onClose }: ModelSettingsModalProps) {
  const modelProviders = useSessionStore((s) => s.modelProviders);
  const saveModelProvider = useSessionStore((s) => s.saveModelProvider);
  const deleteModelProvider = useSessionStore((s) => s.deleteModelProvider);

  const [editing, setEditing] = useState<EditableProvider | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    const models = editing.modelRows
      .map((m) => {
        const rawWindow = m.contextWindowTokens.trim();
        const contextWindowTokens = rawWindow ? Number(rawWindow) : undefined;
        return { id: m.id.trim(), label: m.label.trim(), contextWindowTokens };
      })
      .filter((m) => m.id && m.label);
    if (!name || models.length === 0) return;
    if (models.some((m) => m.contextWindowTokens !== undefined && (!Number.isInteger(m.contextWindowTokens) || m.contextWindowTokens <= 0))) {
      return;
    }

    const env: Record<string, string> = {};
    for (const row of editing.envRows) {
      const key = row.key.trim();
      if (key) env[key] = row.value;
    }

    setSaving(true);
    try {
      await saveModelProvider({
        id: editing.id ?? crypto.randomUUID(),
        name,
        builtin: false,
        env,
        models,
      });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-[560px] max-h-[80vh] bg-[#232325] border border-card-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-card-border shrink-0">
          <h2 className="text-base font-semibold text-white">模型与供应商设置</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/5 text-text-secondary hover:text-neutral-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!editing ? (
            <>
              <div className="space-y-2 mb-4">
                {modelProviders.map((provider) => (
                  <div key={provider.id} className="border border-card-border rounded-xl p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white">{provider.name}</div>
                        <div className="text-xs text-text-secondary mt-0.5 truncate">
                          {provider.models.map((m) => m.label).join(' · ')}
                        </div>
                      </div>
                      {provider.builtin ? (
                        <span className="text-xs text-text-tertiary shrink-0">内置</span>
                      ) : (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setEditing(toEditable(provider))}
                            className="p-1.5 rounded hover:bg-white/5 text-text-secondary hover:text-neutral-200 transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => deleteModelProvider(provider.id)}
                            className="p-1.5 rounded hover:bg-white/5 text-text-secondary hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setEditing(emptyEditable())}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-card-border text-sm text-text-secondary hover:text-neutral-200 hover:border-neutral-500 transition-colors"
              >
                <Plus size={14} />
                添加供应商
              </button>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-text-secondary mb-1 block">供应商名称</label>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="例如：中转 API"
                  className="w-full bg-[#2a2a2c] border border-card-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-neutral-500 transition-colors"
                />
              </div>

              <div>
                <label className="text-xs text-text-secondary mb-1 block">
                  环境变量（如 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY）
                </label>
                <div className="space-y-1.5">
                  {editing.envRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        value={row.key}
                        onChange={(e) => {
                          const envRows = [...editing.envRows];
                          envRows[i] = { ...row, key: e.target.value };
                          setEditing({ ...editing, envRows });
                        }}
                        placeholder="ANTHROPIC_BASE_URL"
                        className="flex-1 min-w-0 bg-[#2a2a2c] border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-neutral-500 transition-colors font-mono"
                      />
                      <input
                        value={row.value}
                        onChange={(e) => {
                          const envRows = [...editing.envRows];
                          envRows[i] = { ...row, value: e.target.value };
                          setEditing({ ...editing, envRows });
                        }}
                        placeholder="https://..."
                        className="flex-1 min-w-0 bg-[#2a2a2c] border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-neutral-500 transition-colors font-mono"
                      />
                      <button
                        onClick={() =>
                          setEditing({ ...editing, envRows: editing.envRows.filter((_, idx) => idx !== i) })
                        }
                        className="p-1.5 rounded hover:bg-white/5 text-text-tertiary hover:text-red-400 transition-colors shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setEditing({ ...editing, envRows: [...editing.envRows, { key: '', value: '' }] })}
                  className="mt-1.5 flex items-center gap-1 text-xs text-text-secondary hover:text-neutral-200 transition-colors"
                >
                  <Plus size={12} />
                  添加环境变量
                </button>
              </div>

              <div>
                <label className="text-xs text-text-secondary mb-1 block">模型列表</label>
                <div className="space-y-2">
                  <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_132px_28px] items-center gap-2 px-1 text-[11px] text-text-tertiary">
                    <span>模型 ID</span>
                    <span>显示名称</span>
                    <span>上下文窗口 <span className="text-text-tertiary/70">（可选）</span></span>
                    <span aria-hidden="true" />
                  </div>
                  {editing.modelRows.map((row, i) => (
                    <div key={i} className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_132px_28px] items-center gap-2">
                      <input
                        value={row.id}
                        onChange={(e) => {
                          const modelRows = [...editing.modelRows];
                          modelRows[i] = { ...row, id: e.target.value };
                          setEditing({ ...editing, modelRows });
                        }}
                        placeholder="模型 ID"
                        className="min-w-0 bg-[#2a2a2c] border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-neutral-500 transition-colors font-mono"
                      />
                      <input
                        value={row.label}
                        onChange={(e) => {
                          const modelRows = [...editing.modelRows];
                          modelRows[i] = { ...row, label: e.target.value };
                          setEditing({ ...editing, modelRows });
                        }}
                        placeholder="显示名称"
                        className="min-w-0 bg-[#2a2a2c] border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-neutral-500 transition-colors"
                      />
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={row.contextWindowTokens}
                        onChange={(e) => {
                          const modelRows = [...editing.modelRows];
                          modelRows[i] = { ...row, contextWindowTokens: e.target.value };
                          setEditing({ ...editing, modelRows });
                        }}
                        placeholder="1000000"
                        className="min-w-0 bg-[#2a2a2c] border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-neutral-500 transition-colors font-mono"
                      />
                      <button
                        onClick={() =>
                          setEditing({ ...editing, modelRows: editing.modelRows.filter((_, idx) => idx !== i) })
                        }
                        className="justify-self-center p-1.5 rounded hover:bg-white/5 text-text-tertiary hover:text-red-400 transition-colors"
                        aria-label={`删除模型 ${row.label || row.id || i + 1}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-4 text-text-tertiary">
                  上下文窗口仅用于 Claude Code 的用量计算和自动压缩，不会改变上游模型的真实容量。
                </p>
                <button
                  onClick={() =>
                    setEditing({ ...editing, modelRows: [...editing.modelRows, { id: '', label: '', contextWindowTokens: '' }] })
                  }
                  className="mt-1.5 flex items-center gap-1 text-xs text-text-secondary hover:text-neutral-200 transition-colors"
                >
                  <Plus size={12} />
                  添加模型
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-card-border shrink-0">
          {editing ? (
            <>
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-white/5 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editing.name.trim()}
                className="px-3 py-1.5 rounded-lg text-sm bg-white text-black hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-white transition-colors"
              >
                保存
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-sm bg-white text-black hover:bg-neutral-200 transition-colors"
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
