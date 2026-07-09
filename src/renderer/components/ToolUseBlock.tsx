import { useState } from 'react';
import { RefreshCw, ChevronRight, ChevronDown, CircleAlert, Pencil } from 'lucide-react';
import type { ToolUseStep } from '../types/chat';
import { useSessionStore } from '../store/sessionStore';

interface ToolUseBlockProps {
  summary: string;
  details: string[];
  isError?: boolean;
  pending?: boolean;
}

export function ToolUseBlock({ summary, details, isError, pending }: ToolUseBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = details.length > 0;

  return (
    <div className="py-1">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`flex items-center gap-2 text-[13px] ${isError ? 'text-red-400' : 'text-text-secondary'} ${hasDetails ? 'cursor-pointer hover:text-neutral-400' : 'cursor-default'} transition-colors`}
      >
        {isError ? (
          <CircleAlert size={14} className="text-red-400 shrink-0" />
        ) : (
          <RefreshCw size={14} className={`text-text-tertiary shrink-0 ${pending ? 'animate-spin' : ''}`} />
        )}
        <span>{summary}</span>
        {hasDetails && (
          expanded
            ? <ChevronDown size={14} className="text-text-tertiary" />
            : <ChevronRight size={14} className="text-text-tertiary" />
        )}
      </button>

      {expanded && (
        <div className="ml-[22px] mt-1 space-y-0.5">
          {details.map((detail, i) => (
            <div key={i} className={`text-[13px] py-0.5 ${isError ? 'text-red-400/80' : 'text-text-secondary'}`}>
              {detail}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface EditInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
}
interface WriteInput {
  file_path?: string;
  content?: string;
}

function toRelativePath(filePath: string, cwd: string): string {
  const normalizedCwd = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return filePath.startsWith(normalizedCwd) ? filePath.slice(normalizedCwd.length) : filePath;
}

// Approximates a diff stat directly from the tool call's own before/after strings (line counts
// of old_string vs new_string) — not a real minimal diff (Claude Code's Edit tool convention
// often includes a few lines of surrounding context in old_string/new_string to keep the match
// unique, so this can overstate the true change size for a small edit inside a larger context
// block). Deliberately not implementing a real diff algorithm for what is a visual-polish
// feature; this is a labeled, known approximation, not a claimed-exact stat.
function editLineDelta(step: ToolUseStep): { added: number; removed: number } | null {
  const input = step.input as EditInput | undefined;
  if (step.toolName === 'Edit' && typeof input?.old_string === 'string' && typeof input?.new_string === 'string') {
    return { added: input.new_string.split('\n').length, removed: input.old_string.split('\n').length };
  }
  if (step.toolName === 'Write') {
    const writeInput = step.input as WriteInput | undefined;
    if (typeof writeInput?.content === 'string') {
      return { added: writeInput.content.split('\n').length, removed: 0 };
    }
  }
  return null;
}

export function FileEditsGroup({ steps, cwd }: { steps: ToolUseStep[]; cwd: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const openFilePreview = useSessionStore((s) => s.openFilePreview);
  const setRightPanelOpen = useSessionStore((s) => s.setRightPanelOpen);

  const verb = steps.every((s) => s.toolName === 'Write') ? '写入' : '编辑';

  return (
    <div className="py-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-neutral-400 transition-colors"
      >
        <Pencil size={13} className="text-text-tertiary shrink-0" />
        <span>已{verb} {steps.length} 个文件</span>
        {collapsed ? <ChevronRight size={13} className="text-text-tertiary" /> : <ChevronDown size={13} className="text-text-tertiary" />}
      </button>
      {!collapsed && (
        <div className="ml-[22px] mt-1 space-y-0.5">
          {steps.map((step, i) => {
            const input = step.input as EditInput | WriteInput | undefined;
            const filePath = input?.file_path;
            const delta = editLineDelta(step);
            const relPath = filePath ? toRelativePath(filePath, cwd) : (step.summary || '未知文件');
            return (
              <div key={step.toolUseId ?? i} className="flex items-center gap-2 text-[13px] py-0.5">
                <span className="text-text-secondary shrink-0">已{step.toolName === 'Write' ? '写入' : '编辑'}</span>
                {filePath ? (
                  <button
                    onClick={() => {
                      openFilePreview(cwd, relPath);
                      setRightPanelOpen(true);
                    }}
                    className="text-accent-orange hover:underline truncate text-left"
                    title={relPath}
                  >
                    {relPath}
                  </button>
                ) : (
                  <span className="text-neutral-300 truncate">{relPath}</span>
                )}
                {delta && (
                  <span className="shrink-0 flex items-center gap-1.5 text-[12px] font-mono">
                    {delta.added > 0 && <span className="text-green-400">+{delta.added}</span>}
                    {delta.removed > 0 && <span className="text-red-400">-{delta.removed}</span>}
                  </span>
                )}
                {step.isError && <CircleAlert size={13} className="text-red-400 shrink-0" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
