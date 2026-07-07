import { useEffect, useRef, useState } from 'react';
import { FileText, Ellipsis, PanelRightOpen } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { InputBar } from './InputBar';
import { ChatNavRail, type ChatNavTick } from './ChatNavRail';
import { useSessionStore } from '../store/sessionStore';
import type { Session, MessageAttachment } from '../types/chat';

interface ChatViewProps {
  session: Session;
  isProcessing: boolean;
  onSend: (text: string, attachments?: MessageAttachment[]) => void;
  onStop: () => void;
  onSessionArchivedOrRemoved: () => void;
}

export function ChatView({ session, isProcessing, onSend, onStop, onSessionArchivedOrRemoved }: ChatViewProps) {
  const rightPanelOpen = useSessionStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useSessionStore((s) => s.toggleRightPanel);
  const archiveSession = useSessionStore((s) => s.archiveSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const forkSession = useSessionStore((s) => s.forkSession);
  const [menuOpen, setMenuOpen] = useState(false);
  const [forking, setForking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const turnRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [ticks, setTicks] = useState<ChatNavTick[]>([]);

  useEffect(() => {
    const next: ChatNavTick[] = [];
    session.messages.forEach((msg, i) => {
      if (msg.role !== 'user') return;
      next.push({ index: i, snippet: msg.content.slice(0, 120) });
    });
    setTicks(next);
  }, [session.messages]);

  const handleTickSelect = (index: number) => {
    const container = scrollRef.current;
    const el = turnRefs.current.get(index);
    if (!container || !el) return;
    container.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' });
  };

  const handleArchive = async () => {
    setMenuOpen(false);
    await archiveSession(session.id);
    onSessionArchivedOrRemoved();
  };

  const handleRemove = async () => {
    setMenuOpen(false);
    await removeSession(session.id);
    onSessionArchivedOrRemoved();
  };

  const handleFork = async () => {
    setMenuOpen(false);
    setForking(true);
    try {
      await forkSession(session.cwd, session.id);
    } finally {
      setForking(false);
    }
  };

  const canFork = !isProcessing && !forking && session.messages.length > 0;

  return (
    <div className="flex-1 bg-main-bg flex flex-col rounded-tl-xl overflow-hidden">
      {/* Top bar */}
      <div className="h-[52px] flex items-center px-4 drag shrink-0 border-b border-transparent">
        <div className="flex items-center gap-2 no-drag min-w-0 flex-1 relative">
          <FileText size={16} className="text-neutral-400 shrink-0" />
          <span className="text-sm font-medium text-neutral-200 truncate">
            {session.title}
          </span>
          <button
            onClick={() => setMenuOpen((open) => !open)}
            className="p-1 rounded hover:bg-white/5 transition-colors text-neutral-500 hover:text-neutral-300 shrink-0"
          >
            <Ellipsis size={16} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute top-full left-6 mt-1 bg-[#2a2a2c] border border-card-border rounded-xl shadow-xl z-50 overflow-hidden w-40">
                <div className="py-1">
                  <button
                    onClick={handleFork}
                    disabled={!canFork}
                    className="w-full flex items-center px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    {forking ? '分叉中...' : '分叉新对话'}
                  </button>
                  <button
                    onClick={handleArchive}
                    className="w-full flex items-center px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 transition-colors text-left"
                  >
                    归档此对话
                  </button>
                  <button
                    onClick={handleRemove}
                    className="w-full flex items-center px-3 py-2 text-sm text-red-400 hover:bg-white/5 transition-colors text-left"
                  >
                    移除此对话
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 no-drag shrink-0">
          <button
            onClick={toggleRightPanel}
            className={`p-1.5 rounded-lg hover:bg-white/5 transition-colors ${rightPanelOpen ? 'text-neutral-200' : 'text-neutral-500 hover:text-neutral-300'}`}
          >
            <PanelRightOpen size={16} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 relative min-h-0">
        <div ref={scrollRef} className="h-full overflow-y-auto px-6 py-4">
          <div className="max-w-[820px] mx-auto">
            {session.messages.map((msg, i) => (
              <div
                key={i}
                ref={(el) => {
                  if (msg.role !== 'user') return;
                  if (el) turnRefs.current.set(i, el);
                  else turnRefs.current.delete(i);
                }}
              >
                <ChatMessage message={msg} />
              </div>
            ))}
          </div>
        </div>
        <ChatNavRail ticks={ticks} onSelect={handleTickSelect} />
      </div>

      {/* Input */}
      <div className="px-6 pb-4">
        <div className="max-w-[820px] mx-auto">
          <InputBar mode="chat" isProcessing={isProcessing} onSend={onSend} onStop={onStop} />
        </div>
      </div>
    </div>
  );
}
