import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, Check, Settings } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { ModelSettingsModal } from './ModelSettingsModal';
import { EFFORT_LEVELS, effortLabel } from '../lib/effortLabels';
import type { EffortLevel } from '../../shared/ipc';

interface ModelEffortPickerProps {
  mode: 'home' | 'chat';
}

interface CascadeTarget {
  providerId: string;
  modelId: string;
  modelLabel: string;
}

// A two-level cascading picker: pick a model first, then (in the same popover) pick a
// reasoning effort for it, mirroring Codex's model selector rather than the two disconnected
// controls this used to be (a flat model list here, plus a separate effort dropdown only
// reachable from Settings).
export function ModelEffortPicker({ mode }: ModelEffortPickerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [cascadeTarget, setCascadeTarget] = useState<CascadeTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const modelProviders = useSessionStore((s) => s.modelProviders);
  const selectedProviderId = useSessionStore((s) => s.selectedProviderId);
  const selectedModelId = useSessionStore((s) => s.selectedModelId);
  const effortLevel = useSessionStore((s) => s.effortLevel);
  const setSelectedModel = useSessionStore((s) => s.setSelectedModel);
  const setEffortLevel = useSessionStore((s) => s.setEffortLevel);
  const changeModelMidConversation = useSessionStore((s) => s.changeModelMidConversation);

  const selectedModelLabel =
    modelProviders.find((p) => p.id === selectedProviderId)?.models.find((m) => m.id === selectedModelId)?.label ??
    selectedModelId;

  const closeMenu = () => {
    setMenuOpen(false);
    setCascadeTarget(null);
  };

  const commit = (providerId: string, modelId: string, effort: EffortLevel | null) => {
    if (mode === 'chat') {
      changeModelMidConversation(providerId, modelId, effort);
    } else {
      setSelectedModel(providerId, modelId);
      setEffortLevel(effort);
    }
    closeMenu();
  };

  return (
    <div className="relative">
      <button
        onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
        className="flex items-center gap-1 text-sm text-neutral-300 hover:bg-white/5 px-2 py-1.5 rounded-lg transition-colors"
      >
        <span className="font-medium">{selectedModelLabel}</span>
        <span className="text-text-tertiary">· {effortLabel(effortLevel)}</span>
        <ChevronDown size={14} className="text-text-secondary" />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} />
          <div className="absolute bottom-full right-0 mb-1 w-64 max-h-96 overflow-y-auto bg-[#2a2a2c] border border-card-border rounded-xl shadow-xl z-50 py-1">
            {!cascadeTarget ? (
              <>
                {modelProviders.map((provider) => (
                  <div key={provider.id}>
                    <div className="px-3 pt-2 pb-1 text-xs text-text-tertiary font-medium">{provider.name}</div>
                    {provider.models.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => setCascadeTarget({ providerId: provider.id, modelId: model.id, modelLabel: model.label })}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5 transition-colors"
                      >
                        {provider.id === selectedProviderId && model.id === selectedModelId ? (
                          <Check size={14} className="text-accent-amber shrink-0" />
                        ) : (
                          <span className="w-3.5 shrink-0" />
                        )}
                        <span className="truncate flex-1 text-left">{model.label}</span>
                        <ChevronRight size={14} className="text-text-tertiary shrink-0" />
                      </button>
                    ))}
                  </div>
                ))}
                <div className="border-t border-card-border mt-1 pt-1">
                  <button
                    onClick={() => {
                      closeMenu();
                      setSettingsOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 transition-colors"
                  >
                    <Settings size={14} className="text-text-secondary" />
                    模型设置...
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  onClick={() => setCascadeTarget(null)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5 transition-colors font-medium"
                >
                  <ChevronLeft size={14} className="text-text-secondary shrink-0" />
                  <span className="truncate">{cascadeTarget.modelLabel}</span>
                </button>
                <div className="border-t border-card-border my-1" />
                {([null, ...EFFORT_LEVELS] as (EffortLevel | null)[]).map((level) => (
                  <button
                    key={level ?? 'default'}
                    onClick={() => commit(cascadeTarget.providerId, cascadeTarget.modelId, level)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5 transition-colors"
                  >
                    {effortLevel === level ? (
                      <Check size={14} className="text-accent-amber shrink-0" />
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    {effortLabel(level)}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
      {settingsOpen && <ModelSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
