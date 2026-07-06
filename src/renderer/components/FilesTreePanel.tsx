import { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, File as FileIcon, RefreshCw } from 'lucide-react';
import type { FileTreeEntry } from '../../shared/ipc';

interface FilesTreePanelProps {
  cwd: string;
}

export function FilesTreePanel({ cwd }: FilesTreePanelProps) {
  const [rootEntries, setRootEntries] = useState<FileTreeEntry[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewReason, setPreviewReason] = useState<'binary' | 'too-large' | 'not-found' | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRootEntries(null);
    setSelectedPath(null);
    setPreviewContent(null);
    setPreviewReason(null);
    window.electronAPI.claude.listDirEntries({ cwd, relativePath: '' }).then((res) => {
      if (!cancelled) setRootEntries(res.entries);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const reload = () => {
    setRootEntries(null);
    window.electronAPI.claude.listDirEntries({ cwd, relativePath: '' }).then((res) => {
      setRootEntries(res.entries);
    });
  };

  const openFile = (relativePath: string) => {
    setSelectedPath(relativePath);
    setPreviewLoading(true);
    setPreviewContent(null);
    setPreviewReason(null);
    window.electronAPI.claude.getFilePreview({ cwd, relativePath }).then((res) => {
      setPreviewContent(res.content);
      setPreviewReason(res.reason ?? null);
      setPreviewLoading(false);
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border shrink-0">
        <span className="text-xs text-text-tertiary">文件浏览器</span>
        <button
          onClick={reload}
          className="p-1 rounded hover:bg-white/5 text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="max-h-[50%] overflow-y-auto border-b border-card-border shrink-0">
        {rootEntries === null ? (
          <div className="p-4 text-sm text-text-tertiary">加载中...</div>
        ) : rootEntries.length === 0 ? (
          <div className="p-4 text-sm text-text-tertiary">空目录</div>
        ) : (
          rootEntries.map((entry) => (
            <TreeNode
              key={entry.relativePath}
              cwd={cwd}
              entry={entry}
              depth={0}
              selectedPath={selectedPath}
              onSelectFile={openFile}
            />
          ))
        )}
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        {selectedPath ? (
          <pre className="text-[11px] leading-[1.5] font-mono p-3 whitespace-pre-wrap break-all text-neutral-300">
            {previewLoading
              ? '加载中...'
              : previewReason === 'binary'
                ? '(二进制文件，未预览)'
                : previewReason === 'too-large'
                  ? '(文件过大，未预览)'
                  : previewReason === 'not-found'
                    ? '(文件不存在)'
                    : (previewContent ?? '')}
          </pre>
        ) : (
          <div className="p-4 text-sm text-text-tertiary">选择一个文件以预览</div>
        )}
      </div>
    </div>
  );
}

interface TreeNodeProps {
  cwd: string;
  entry: FileTreeEntry;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (relativePath: string) => void;
}

function TreeNode({ cwd, entry, depth, selectedPath, onSelectFile }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileTreeEntry[] | null>(null);

  const toggle = () => {
    if (!entry.isDirectory) {
      onSelectFile(entry.relativePath);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      window.electronAPI.claude.listDirEntries({ cwd, relativePath: entry.relativePath }).then((res) => {
        setChildren(res.entries);
      });
    }
  };

  return (
    <div>
      <button
        onClick={toggle}
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
        className={`w-full flex items-center gap-1.5 py-1 pr-2 text-xs text-left transition-colors ${
          selectedPath === entry.relativePath ? 'bg-white/10' : 'hover:bg-white/5'
        }`}
      >
        {entry.isDirectory ? (
          expanded ? (
            <ChevronDown size={12} className="shrink-0 text-text-tertiary" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-text-tertiary" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {entry.isDirectory ? (
          <Folder size={13} className="shrink-0 text-accent-amber" />
        ) : (
          <FileIcon size={13} className="shrink-0 text-neutral-400" />
        )}
        <span className="truncate text-neutral-300">{entry.name}</span>
      </button>
      {expanded &&
        children?.map((child) => (
          <TreeNode
            key={child.relativePath}
            cwd={cwd}
            entry={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
          />
        ))}
    </div>
  );
}
