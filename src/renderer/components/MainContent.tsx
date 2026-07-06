import { ArrowLeft, ArrowRight, PanelRightOpen } from 'lucide-react';
import { InputBar } from './InputBar';
import { IntegrationCards } from './IntegrationCards';
import { useSessionStore } from '../store/sessionStore';
import type { MessageAttachment } from '../types/chat';

interface MainContentProps {
  onSend: (text: string, attachments?: MessageAttachment[]) => void;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}

export function MainContent({ onSend, onBack, onForward, canGoBack, canGoForward }: MainContentProps) {
  const rightPanelOpen = useSessionStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useSessionStore((s) => s.toggleRightPanel);

  return (
    <main className="flex-1 bg-main-bg flex flex-col rounded-tl-xl overflow-hidden">
      {/* Top bar */}
      <div className="h-[52px] flex items-center px-4 drag shrink-0">
        <div className="flex items-center gap-1 no-drag">
          <button
            onClick={onBack}
            disabled={!canGoBack}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-neutral-500 hover:text-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <ArrowLeft size={18} />
          </button>
          <button
            onClick={onForward}
            disabled={!canGoForward}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-neutral-500 hover:text-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <ArrowRight size={18} />
          </button>
        </div>
        <div className="flex-1" />
        <button
          onClick={toggleRightPanel}
          className={`p-1.5 rounded-lg hover:bg-white/5 transition-colors no-drag ${rightPanelOpen ? 'text-neutral-200' : 'text-neutral-500 hover:text-neutral-300'}`}
        >
          <PanelRightOpen size={18} />
        </button>
      </div>

      {/* Main content - centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pb-16">
        <h1 className="text-[22px] font-medium text-white mb-8 tracking-tight">
          我们应该在CCodeBox中做些什么？
        </h1>
        <div className="w-full max-w-[720px]">
          <InputBar mode="home" onSend={onSend} />
        </div>
        <IntegrationCards />
      </div>
    </main>
  );
}
