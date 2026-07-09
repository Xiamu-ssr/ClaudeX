import { useEffect, useRef, useState } from 'react';
import { Plus, ShieldCheck, ShieldAlert, ChevronDown, Mic, ArrowUp, Square, FileText, Check, X, Clock } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { ModelEffortPicker } from './ModelEffortPicker';
import { ContextUsageRing } from './ContextUsageRing';
import { SlashCommandMenu } from './SlashCommandMenu';
import type { PermissionMode } from '../../shared/ipc';
import type { MessageAttachment } from '../types/chat';

interface InputBarProps {
  mode?: 'home' | 'chat';
  isProcessing?: boolean;
  onSend?: (text: string, attachments?: MessageAttachment[]) => void;
  onStop?: () => void;
}

const permissionModeLabels: Record<PermissionMode, string> = {
  bypassPermissions: '完全访问',
  default: '默认权限',
};

// The live `slash_commands` list (from the CLI's own session-init event) mixes real,
// user-invocable built-ins with internal/deprecated ones — confirmed by hand: `/agents` now
// just prints "The /agents wizard has been removed", and names like `__remote-workflow`,
// `heapdump`, `design-consent`/`design-revoke`/`team-onboarding`/`insights`/`recap`/`goal` have
// no confirmed, documented, general-purpose behavior. Rather than show the CLI's raw list and
// hope every future/internal command name is harmless, the menu only ever offers a command if
// it's on this explicit allowlist (verified real, stable, useful as a bare invocation) OR it
// matches a real name in the user's own plugin/skill catalog (see SlashCommandMenu.tsx) —
// unknown names are excluded by default, not included by default. Still fully sendable by
// typing the whole command manually; this only curates what the popup suggests.
const KNOWN_GOOD_BUILTINS: Record<string, string> = {
  clear: '清空当前对话上下文（历史仍保留，可通过 --resume 找回）',
  compact: '压缩对话历史，摘要保留关键上下文',
  context: '查看当前上下文窗口占用情况',
  init: '生成或更新项目的 CLAUDE.md',
  review: '审查一个 GitHub PR',
  'security-review': '对当前改动做一次安全审查',
  usage: '查看用量与费用统计',
  config: '查看或修改 CLI 配置（需要参数，例如 /config model=opus）',
};

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function InputBar({ mode = 'home', isProcessing = false, onSend, onStop }: InputBarProps) {
  const [message, setMessage] = useState('');
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [slashHighlightIndex, setSlashHighlightIndex] = useState(0);
  const [catalogDescriptions, setCatalogDescriptions] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode !== 'chat') return;
    window.electronAPI.claude
      .loadPluginCatalog()
      .then(({ catalog }) => {
        const map: Record<string, string> = {};
        for (const p of [...catalog.officialSkills, ...catalog.personalSkills, ...catalog.connectors, ...catalog.thirdPartyPlugins]) {
          if (p.description) map[p.name] = p.description;
        }
        setCatalogDescriptions(map);
      })
      .catch(() => {});
  }, [mode]);

  const projects = useSessionStore((s) => s.projects);
  const selectedProjectCwd = useSessionStore((s) => s.selectedProjectCwd);
  const setSelectedProjectCwd = useSessionStore((s) => s.setSelectedProjectCwd);
  const permissionMode = useSessionStore((s) => s.permissionMode);
  const setPermissionMode = useSessionStore((s) => s.setPermissionMode);
  const slashCommands = useSessionStore((s) => s.slashCommands);
  const isQueryingContext = useSessionStore((s) => s.isQueryingContext);
  const queuedMessages = useSessionStore((s) => s.queuedMessages);
  const queueMessage = useSessionStore((s) => s.queueMessage);
  const removeQueuedMessage = useSessionStore((s) => s.removeQueuedMessage);

  const placeholder = mode === 'home' ? '随心输入' : '要求后续变更';
  const selectedProject = projects.find((p) => p.cwd === selectedProjectCwd);
  const canAddMore = attachments.length < MAX_ATTACHMENTS;

  const slashMenuMatch = mode === 'chat' ? message.match(/^\/(\S*)$/) : null;
  const slashMenuOpen = slashMenuMatch !== null;
  const slashFilter = (slashMenuMatch?.[1] ?? '').toLowerCase();
  // Curate first (allowlisted built-in OR a real catalog name), then text-filter/sort — the
  // curation step must run before anything index-based (highlight, arrow-key wrap) so those
  // stay consistent with what's actually rendered.
  const filteredSlashCommands = slashMenuOpen
    ? slashCommands
        .filter((name) => name in KNOWN_GOOD_BUILTINS || name in catalogDescriptions)
        .filter((name) => name.toLowerCase().includes(slashFilter))
        .sort((a, b) => {
          const aStarts = a.toLowerCase().startsWith(slashFilter);
          const bStarts = b.toLowerCase().startsWith(slashFilter);
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return a.localeCompare(b);
        })
    : [];
  const slashMenuItems = filteredSlashCommands.map((name) => ({ name, description: catalogDescriptions[name] ?? KNOWN_GOOD_BUILTINS[name] }));

  const selectSlashCommand = (name: string) => {
    setMessage(`/${name} `);
    setSlashHighlightIndex(0);
  };

  const addFiles = async (files: FileList | File[]) => {
    if (!canAddMore) {
      setAttachmentError(`最多添加 ${MAX_ATTACHMENTS} 张图片`);
      return;
    }
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const room = MAX_ATTACHMENTS - attachments.length;
    const toAdd = imageFiles.slice(0, room);
    const accepted = toAdd.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    const oversized = toAdd.length !== accepted.length;

    if (imageFiles.length > room) {
      setAttachmentError(`最多添加 ${MAX_ATTACHMENTS} 张图片`);
    } else if (oversized) {
      setAttachmentError('单张图片不能超过 5MB');
    } else {
      setAttachmentError(null);
    }

    if (accepted.length === 0) return;
    const newAttachments = await Promise.all(
      accepted.map(async (file) => ({
        name: file.name,
        mimeType: file.type,
        dataUrl: await readFileAsDataUrl(file),
      }))
    );
    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setAttachmentError(null);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    onSend?.(trimmed, attachments.length > 0 ? attachments : undefined);
    setMessage('');
    setAttachments([]);
    setAttachmentError(null);
  };

  const handleQueue = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    queueMessage(trimmed, attachments.length > 0 ? attachments : undefined);
    setMessage('');
    setAttachments([]);
    setAttachmentError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenuOpen && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashHighlightIndex((i) => (i + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashHighlightIndex((i) => (i - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectSlashCommand(filteredSlashCommands[Math.min(slashHighlightIndex, filteredSlashCommands.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMessage('');
        return;
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // isQueryingContext: sendMessage itself refuses to fire while a context-usage side-channel
      // query is using this session's stdin (see sessionStore.ts) — queue instead of silently
      // dropping the message, same as the real isProcessing case.
      if (isProcessing || isQueryingContext) {
        handleQueue();
      } else {
        handleSend();
      }
    }
  };

  return (
    <div className="w-full">
      {queuedMessages.length > 0 && (
        <div className="mb-2 flex flex-col gap-1.5">
          {queuedMessages.map((qm) => (
            <div
              key={qm.id}
              data-testid="queued-message-chip"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-card-border text-xs text-neutral-300"
            >
              <Clock size={12} className="text-text-tertiary shrink-0" />
              <span className="flex-1 truncate">{qm.text}</span>
              <button onClick={() => removeQueuedMessage(qm.id)} className="text-text-tertiary hover:text-neutral-200 shrink-0">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Input card */}
      <div className="relative border border-card-border rounded-2xl bg-card">
        <SlashCommandMenu open={slashMenuOpen} items={slashMenuItems} highlightedIndex={Math.min(slashHighlightIndex, Math.max(slashMenuItems.length - 1, 0))} onSelect={selectSlashCommand} />
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="px-4 pt-4 flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-card-border">
                <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center text-white hover:bg-black/90"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {attachmentError && <div className="px-4 pt-2 text-xs text-red-400">{attachmentError}</div>}

        {/* Text area */}
        <div className="px-4 pt-4 pb-2">
          <textarea
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setSlashHighlightIndex(0);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={1}
            className="w-full bg-transparent resize-none outline-none text-white text-[15px] placeholder:text-text-secondary leading-relaxed"
          />
        </div>

        {/* Toolbar */}
        <div className="px-3 pb-3 flex items-center justify-between">
          {/* Left controls */}
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!canAddMore}
              title={canAddMore ? '添加图片' : `最多添加 ${MAX_ATTACHMENTS} 张图片`}
              className="p-1 hover:bg-white/5 rounded-lg transition-colors text-neutral-400 hover:text-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <Plus size={16} />
            </button>

            {/* Permission mode picker */}
            <div className="relative">
              <button
                onClick={() => setPermissionMenuOpen(!permissionMenuOpen)}
                className="flex items-center gap-1 text-[13px] text-accent-amber hover:bg-white/5 px-1.5 py-1 rounded-lg transition-colors"
              >
                {permissionMode === 'bypassPermissions' ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
                {permissionModeLabels[permissionMode]}
                <ChevronDown size={12} className="text-text-secondary" />
              </button>
              {permissionMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPermissionMenuOpen(false)} />
                  <div className="absolute bottom-full left-0 mb-1 w-56 bg-[#2a2a2c] border border-card-border rounded-xl shadow-xl z-50 overflow-hidden py-1">
                    {(Object.keys(permissionModeLabels) as PermissionMode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          setPermissionMode(m);
                          setPermissionMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5 transition-colors"
                      >
                        {m === permissionMode ? (
                          <Check size={14} className="text-accent-amber" />
                        ) : (
                          <span className="w-3.5" />
                        )}
                        {permissionModeLabels[m]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1">
            {mode === 'chat' && <ContextUsageRing />}
            <ModelEffortPicker mode={mode} />
            <button className="p-1 hover:bg-white/5 rounded-lg transition-colors text-neutral-400 hover:text-neutral-200">
              <Mic size={16} />
            </button>
            {isProcessing ? (
              <>
                <button
                  onClick={() => onStop?.()}
                  className="w-7 h-7 rounded-full border-2 border-accent-orange flex items-center justify-center transition-colors ml-1 hover:bg-white/5"
                >
                  <Square size={11} className="text-accent-orange fill-accent-orange" />
                </button>
                {message.trim() && (
                  <button
                    onClick={handleQueue}
                    title="排队，等当前回复完成后自动发送"
                    className="w-7 h-7 rounded-full bg-white hover:bg-neutral-200 flex items-center justify-center transition-colors ml-1"
                  >
                    <ArrowUp size={14} className="text-black" />
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={isQueryingContext ? handleQueue : handleSend}
                title={isQueryingContext ? '正在查询上下文用量，发送将先排队' : undefined}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ml-1 ${message.trim() ? 'bg-white hover:bg-neutral-200' : 'bg-neutral-600 hover:bg-neutral-500'}`}
              >
                <ArrowUp size={14} className={message.trim() ? 'text-black' : 'text-white'} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Project indicator (home mode only) */}
      {mode === 'home' && (
        <div className="mt-2 relative inline-block">
          <button
            onClick={() => setProjectMenuOpen(!projectMenuOpen)}
            className="flex items-center gap-2 px-1 text-sm text-text-secondary hover:text-neutral-300 transition-colors"
          >
            <FileText size={14} />
            {selectedProject?.displayName ?? '选择项目'}
            <ChevronDown size={12} />
          </button>
          {projectMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setProjectMenuOpen(false)} />
              <div className="absolute bottom-full left-0 mb-1 w-64 max-h-72 overflow-y-auto bg-[#2a2a2c] border border-card-border rounded-xl shadow-xl z-50 py-1">
                {projects.length === 0 && (
                  <div className="px-3 py-2 text-sm text-text-tertiary">没有找到项目</div>
                )}
                {projects.map((project) => (
                  <button
                    key={project.cwd}
                    onClick={() => {
                      setSelectedProjectCwd(project.cwd);
                      setProjectMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5 transition-colors"
                  >
                    {project.cwd === selectedProjectCwd ? (
                      <Check size={14} className="text-accent-amber shrink-0" />
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{project.displayName}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
