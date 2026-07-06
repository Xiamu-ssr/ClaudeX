import { useEffect, useState } from 'react';
import { Folder, GitBranch, Terminal, Globe, X } from 'lucide-react';
import { useSessionStore, type RightPanelTab } from '../store/sessionStore';
import { FilesTreePanel } from './FilesTreePanel';
import { ReviewPanel } from './ReviewPanel';
import { TerminalPanel } from './TerminalPanel';
import { BrowserPanel } from './BrowserPanel';

interface RightPanelProps {
  cwd: string;
}

const ALL_TABS: Array<{ id: RightPanelTab; label: string; icon: typeof Folder }> = [
  { id: 'files', label: '文件', icon: Folder },
  { id: 'review', label: '审查', icon: GitBranch },
  { id: 'terminal', label: '终端', icon: Terminal },
  { id: 'browser', label: '浏览器', icon: Globe },
];

export function RightPanel({ cwd }: RightPanelProps) {
  const rightPanelTab = useSessionStore((s) => s.rightPanelTab);
  const setRightPanelTab = useSessionStore((s) => s.setRightPanelTab);
  const setRightPanelOpen = useSessionStore((s) => s.setRightPanelOpen);
  // The terminal holds a live shell process, so once opened it stays mounted
  // (CSS-hidden instead of unmounted) across tab switches rather than killing
  // and respawning the shell every time the user glances at another tab.
  const [terminalMounted, setTerminalMounted] = useState(false);
  useEffect(() => {
    if (rightPanelTab === 'terminal') setTerminalMounted(true);
  }, [rightPanelTab]);

  // The Review tab (git diff) only makes sense for a real git repo — hidden rather than
  // disabled when it doesn't apply, per the existing UI convention of not showing dead controls.
  const [isRepo, setIsRepo] = useState(false);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.claude.getGitStatus({ cwd }).then((res) => {
      if (!cancelled) setIsRepo(res.isRepo);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  // If the cwd stops being a repo while Review is the active tab, snap back to Files —
  // otherwise the selected tab's button would vanish while its content stays on screen.
  useEffect(() => {
    if (!isRepo && rightPanelTab === 'review') setRightPanelTab('files');
  }, [isRepo, rightPanelTab, setRightPanelTab]);

  const tabs = ALL_TABS.filter((tab) => tab.id !== 'review' || isRepo);

  return (
    <aside className="w-[420px] shrink-0 bg-main-bg border-l border-card-border flex flex-col rounded-tr-xl overflow-hidden">
      <div className="h-[52px] flex items-center px-2 gap-1 shrink-0 border-b border-card-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setRightPanelTab(tab.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
              rightPanelTab === tab.id
                ? 'bg-white/10 text-white'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setRightPanelOpen(false)}
          className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-neutral-500 hover:text-neutral-300"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div className={`h-full ${rightPanelTab === 'files' ? '' : 'hidden'}`}>
          <FilesTreePanel cwd={cwd} />
        </div>
        <div className={`h-full ${rightPanelTab === 'review' ? '' : 'hidden'}`}>
          <ReviewPanel cwd={cwd} />
        </div>
        {terminalMounted && (
          <div className={`h-full ${rightPanelTab === 'terminal' ? '' : 'hidden'}`}>
            <TerminalPanel cwd={cwd} />
          </div>
        )}
        <div className={`h-full ${rightPanelTab === 'browser' ? '' : 'hidden'}`}>
          <BrowserPanel />
        </div>
      </div>
    </aside>
  );
}
