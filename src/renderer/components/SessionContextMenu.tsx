import { Copy, Pencil } from 'lucide-react';
import { useState } from 'react';

interface SessionContextMenuProps {
  sessionId: string;
  onClose: () => void;
  onStartRename: () => void;
}

// Session IDs and transcript titles are already known locally from Claude Code's JSONL
// history. This menu therefore never needs to send a prompt or call an upstream provider.
export function SessionContextMenu({ sessionId, onClose, onStartRename }: SessionContextMenuProps) {
  const [copied, setCopied] = useState(false);

  const copySessionId = async () => {
    try {
      await window.electronAPI.copyToClipboard({ text: sessionId });
      setCopied(true);
      window.setTimeout(onClose, 700);
    } catch {
      // Keep the menu open if the native clipboard unexpectedly fails, rather than claiming
      // it succeeded.
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-1 top-full mt-1 min-w-40 bg-[#2a2a2c] border border-card-border rounded-xl shadow-xl z-50 overflow-hidden py-1">
        <button
          onClick={copySessionId}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5 transition-colors"
        >
          <Copy size={14} />
          {copied ? '已复制' : '复制会话 ID'}
        </button>
        <button
          onClick={onStartRename}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5 transition-colors"
        >
          <Pencil size={14} />
          重命名
        </button>
      </div>
    </>
  );
}
