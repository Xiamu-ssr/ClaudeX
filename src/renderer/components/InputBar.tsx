import { useRef, useState } from 'react';
import { Plus, ShieldCheck, ShieldAlert, ChevronDown, Mic, ArrowUp, Square, FileText, Check, X } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { ModelEffortPicker } from './ModelEffortPicker';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projects = useSessionStore((s) => s.projects);
  const selectedProjectCwd = useSessionStore((s) => s.selectedProjectCwd);
  const setSelectedProjectCwd = useSessionStore((s) => s.setSelectedProjectCwd);
  const permissionMode = useSessionStore((s) => s.permissionMode);
  const setPermissionMode = useSessionStore((s) => s.setPermissionMode);

  const placeholder = mode === 'home' ? '随心输入' : '要求后续变更';
  const selectedProject = projects.find((p) => p.cwd === selectedProjectCwd);
  const canAddMore = attachments.length < MAX_ATTACHMENTS;

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-full">
      {/* Input card */}
      <div className="border border-card-border rounded-2xl bg-card">
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
            onChange={(e) => setMessage(e.target.value)}
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
              className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-neutral-400 hover:text-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <Plus size={18} />
            </button>

            {/* Permission mode picker */}
            <div className="relative">
              <button
                onClick={() => setPermissionMenuOpen(!permissionMenuOpen)}
                className="flex items-center gap-1.5 text-sm text-accent-amber hover:bg-white/5 px-2 py-1.5 rounded-lg transition-colors"
              >
                {permissionMode === 'bypassPermissions' ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}
                {permissionModeLabels[permissionMode]}
                <ChevronDown size={14} className="text-text-secondary" />
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
            <ModelEffortPicker mode={mode} />
            <button className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-neutral-400 hover:text-neutral-200">
              <Mic size={18} />
            </button>
            {isProcessing ? (
              <button
                onClick={() => onStop?.()}
                className="w-8 h-8 rounded-full border-2 border-accent-orange flex items-center justify-center transition-colors ml-1 hover:bg-white/5"
              >
                <Square size={12} className="text-accent-orange fill-accent-orange" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ml-1 ${message.trim() ? 'bg-white hover:bg-neutral-200' : 'bg-neutral-600 hover:bg-neutral-500'}`}
              >
                <ArrowUp size={16} className={message.trim() ? 'text-black' : 'text-white'} />
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
