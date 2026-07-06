import { useState } from 'react';
import { Pin, PinOff, Pencil, FolderOpen, GitBranch, Archive, Trash2 } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';

interface ProjectContextMenuProps {
  cwd: string;
  pinned: boolean;
  onClose: () => void;
  onStartRename: () => void;
}

export function ProjectContextMenu({ cwd, pinned, onClose, onStartRename }: ProjectContextMenuProps) {
  const [mode, setMode] = useState<'menu' | 'worktree'>('menu');
  const [branchName, setBranchName] = useState('');
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [creatingWorktree, setCreatingWorktree] = useState(false);

  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const setProjectPinned = useSessionStore((s) => s.setProjectPinned);
  const removeProject = useSessionStore((s) => s.removeProject);
  const archiveSession = useSessionStore((s) => s.archiveSession);
  const showInFinder = useSessionStore((s) => s.showInFinder);
  const createWorktree = useSessionStore((s) => s.createWorktree);

  const handleTogglePin = async () => {
    await setProjectPinned(cwd, !pinned);
    onClose();
  };

  const handleShowInFinder = async () => {
    await showInFinder(cwd);
    onClose();
  };

  const handleArchiveAll = async () => {
    const sessions = sessionsByProject[cwd] ?? [];
    for (const session of sessions) {
      await archiveSession(session.sessionId);
    }
    onClose();
  };

  const handleRemove = async () => {
    await removeProject(cwd);
    onClose();
  };

  const handleCreateWorktree = async () => {
    const trimmed = branchName.trim();
    if (!trimmed) return;
    setCreatingWorktree(true);
    setWorktreeError(null);
    const result = await createWorktree(cwd, trimmed);
    setCreatingWorktree(false);
    if (result.ok) {
      onClose();
    } else {
      setWorktreeError(result.message ?? '创建失败');
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-2 right-2 top-full mt-1 bg-[#2a2a2c] border border-card-border rounded-xl shadow-xl z-50 overflow-hidden">
        {mode === 'menu' ? (
          <div className="py-1">
            <button
              onClick={handleTogglePin}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 transition-colors"
            >
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
              {pinned ? '取消置顶' : '置顶'}
            </button>
            <button
              onClick={onStartRename}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 transition-colors"
            >
              <Pencil size={14} />
              重命名
            </button>
            <button
              onClick={handleShowInFinder}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 transition-colors"
            >
              <FolderOpen size={14} />
              在 Finder 中显示
            </button>
            <button
              onClick={() => setMode('worktree')}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 transition-colors"
            >
              <GitBranch size={14} />
              创建工作树
            </button>
            <button
              onClick={handleArchiveAll}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 transition-colors"
            >
              <Archive size={14} />
              归档全部会话
            </button>
            <div className="my-1 border-t border-card-border" />
            <button
              onClick={handleRemove}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-white/5 transition-colors"
            >
              <Trash2 size={14} />
              移除
            </button>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            <div className="text-xs text-text-tertiary">新分支名称</div>
            <input
              autoFocus
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateWorktree();
                if (e.key === 'Escape') setMode('menu');
              }}
              placeholder="feature/my-branch"
              className="w-full bg-card border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-text-secondary outline-none focus:border-neutral-500 transition-colors"
            />
            {worktreeError && <div className="text-xs text-red-400">{worktreeError}</div>}
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setMode('menu')}
                className="px-2.5 py-1 rounded-md text-xs text-neutral-400 hover:bg-white/5 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreateWorktree}
                disabled={creatingWorktree || !branchName.trim()}
                className="px-2.5 py-1 rounded-md text-xs bg-white/10 text-white hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {creatingWorktree ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
