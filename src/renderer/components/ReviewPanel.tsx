import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import type { GitFileDiff } from '../../shared/ipc';

interface ReviewPanelProps {
  cwd: string;
}

const STATUS_LABELS: Record<GitFileDiff['status'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
};

const STATUS_COLORS: Record<GitFileDiff['status'], string> = {
  modified: 'text-accent-amber',
  added: 'text-green-400',
  deleted: 'text-red-400',
  renamed: 'text-blue-400',
  untracked: 'text-neutral-400',
};

function diffLineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-green-400 bg-green-400/10';
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-red-400 bg-red-400/10';
  if (line.startsWith('@@')) return 'text-blue-400';
  return 'text-neutral-400';
}

// Same +/- line-prefix rule as diffLineClass, aggregated across every changed file's diff —
// purely derived from data already on the client, no new backend call.
function countDiffLines(files: GitFileDiff[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const f of files) {
    for (const line of f.diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++;
      else if (line.startsWith('-') && !line.startsWith('---')) removed++;
    }
  }
  return { added, removed };
}

export function ReviewPanel({ cwd }: ReviewPanelProps) {
  const isProcessing = useSessionStore((s) => s.isProcessing);
  const [isRepo, setIsRepo] = useState(true);
  const [files, setFiles] = useState<GitFileDiff[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.electronAPI.claude.getGitDiff({ cwd }).then((res) => {
      if (cancelled) return;
      setIsRepo(res.isRepo);
      setFiles(res.files);
      setSelectedPath((prev) => (prev && res.files.some((f) => f.path === prev) ? prev : (res.files[0]?.path ?? null)));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, isProcessing]);

  const reload = () => {
    setLoading(true);
    window.electronAPI.claude.getGitDiff({ cwd }).then((res) => {
      setIsRepo(res.isRepo);
      setFiles(res.files);
      setSelectedPath((prev) => (prev && res.files.some((f) => f.path === prev) ? prev : (res.files[0]?.path ?? null)));
      setLoading(false);
    });
  };

  const selectedFile = files.find((f) => f.path === selectedPath) ?? null;

  if (loading) {
    return <div className="p-4 text-sm text-text-tertiary">加载中...</div>;
  }

  if (!isRepo) {
    return <div className="p-4 text-sm text-text-tertiary">当前目录不是 Git 仓库</div>;
  }

  const { added, removed } = countDiffLines(files);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border shrink-0">
        <span className="text-xs text-text-tertiary">
          已编辑 {files.length} 个文件 · <span className="text-green-400">+{added}</span>{' '}
          <span className="text-red-400">-{removed}</span>
        </span>
        <button
          onClick={reload}
          className="p-1 rounded hover:bg-white/5 text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {files.length === 0 ? (
        <div className="p-4 text-sm text-text-tertiary">没有未提交的变更</div>
      ) : (
        <>
          <div className="max-h-[35%] overflow-y-auto border-b border-card-border shrink-0">
            {files.map((f) => (
              <button
                key={f.path}
                onClick={() => setSelectedPath(f.path)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                  selectedPath === f.path ? 'bg-white/10' : 'hover:bg-white/5'
                }`}
              >
                <span className={`w-3 shrink-0 font-mono font-semibold ${STATUS_COLORS[f.status]}`}>
                  {STATUS_LABELS[f.status]}
                </span>
                <span className="truncate text-neutral-300">{f.path}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {selectedFile && (
              <pre className="text-[11px] leading-[1.5] font-mono p-3 whitespace-pre-wrap break-all">
                {selectedFile.diff ? (
                  selectedFile.diff.split('\n').map((line, i) => (
                    <div key={i} className={diffLineClass(line)}>
                      {line || ' '}
                    </div>
                  ))
                ) : (
                  <span className="text-text-tertiary">(无可预览内容)</span>
                )}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}
