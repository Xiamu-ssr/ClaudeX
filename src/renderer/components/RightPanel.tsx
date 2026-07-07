import { useEffect, useRef, useState } from 'react';
import { Folder, GitBranch, Terminal, Globe, X } from 'lucide-react';
import { useSessionStore, type RightPanelTab } from '../store/sessionStore';
import { FilesTreePanel } from './FilesTreePanel';
import { ReviewPanel } from './ReviewPanel';
import { TerminalPanel } from './TerminalPanel';
import { BrowserPanel } from './BrowserPanel';

interface RightPanelProps {
  cwd: string;
}

// Freeform resize range + persistence. localStorage is a renderer/DOM API, so no IPC is
// needed in this Electron context. The panel is the last flex child with `shrink-0` while
// its siblings are `flex-1`, so it is anchored to the window's right edge — its LEFT edge is
// the one that moves during a drag. Dragging that edge leftward (clientX decreases) widens
// the panel; the drag math in onMouseMove encodes that with a minus sign.
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 420;
const STORAGE_KEY = 'ccodebox:rightPanelWidth';

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

  // Width is read once on mount from localStorage (clamped even when stored, in case the
  // range constants change later) and written only at drag end to avoid excessive writes.
  const [width, setWidth] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_WIDTH;
    const parsed = parseInt(stored, 10);
    if (Number.isNaN(parsed)) return DEFAULT_WIDTH;
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
  });

  // widthRef mirrors `width` synchronously so the window-level mouseup handler — which is
  // subscribed once (empty-deps effect) and would otherwise close over a stale `width` —
  // can persist the true final width on drag end. dragRef holds the drag-start snapshot so
  // the mousemove handler reads the latest start point without being re-subscribed per render.
  const widthRef = useRef(width);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { startX, startWidth } = dragRef.current;
      // MINUS sign: panel's right edge is fixed, left edge is the moving one, so a leftward
      // drag (clientX decreases, delta negative) must WIDEN the panel (startWidth - delta).
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth - (e.clientX - startX)));
      widthRef.current = next;
      setWidth(next);
    };
    const onMouseUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(STORAGE_KEY, String(widthRef.current));
    };
    // Listen on window, not the handle element, so the drag keeps tracking even if the cursor
    // leaves the 4px strip mid-drag.
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

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

  const onHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: widthRef.current };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <aside
      style={{ width }}
      className="relative shrink-0 bg-main-bg border-l border-card-border flex flex-col rounded-tr-xl overflow-hidden"
    >
      {/* 4px invisible-until-hover resize handle on the panel's left edge. Absolutely
          positioned to span the full height (overlapping the tab bar + content area) and
          z-10 so it stays clickable above both. Drag continues via the window-level listeners
          above even if the cursor leaves the 4px strip mid-drag. */}
      <div
        data-testid="right-panel-resize-handle"
        onMouseDown={onHandleMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 z-10 cursor-col-resize transition-colors hover:bg-accent-orange/40 active:bg-accent-orange/60"
      />
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
