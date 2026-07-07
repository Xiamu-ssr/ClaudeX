import { useEffect, useState } from 'react';
import { ArrowLeft, PanelRightOpen } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useSessionStore } from '../store/sessionStore';
import { getLanguageForFilename } from '../utils/fileLanguage';

type PreviewReason = 'binary' | 'too-large' | 'not-found';

interface FilePreviewState {
  content: string | null;
  reason: PreviewReason | null;
  loading: boolean;
}

export function FilePreviewPane() {
  const previewFile = useSessionStore((s) => s.previewFile);
  const closeFilePreview = useSessionStore((s) => s.closeFilePreview);
  const rightPanelOpen = useSessionStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useSessionStore((s) => s.toggleRightPanel);

  const [state, setState] = useState<FilePreviewState>({ content: null, reason: null, loading: true });

  useEffect(() => {
    if (!previewFile) {
      setState({ content: null, reason: null, loading: false });
      return;
    }
    let cancelled = false;
    setState({ content: null, reason: null, loading: true });
    window.electronAPI.claude
      .getFilePreview({ cwd: previewFile.cwd, relativePath: previewFile.relativePath })
      .then((res) => {
        if (cancelled) return;
        setState({ content: res.content, reason: res.reason ?? null, loading: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ content: null, reason: 'not-found', loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [previewFile?.cwd, previewFile?.relativePath]);

  if (!previewFile) return null;

  const fileName = previewFile.relativePath.split('/').pop() ?? previewFile.relativePath;

  return (
    <main className="flex-1 bg-main-bg flex flex-col rounded-tl-xl overflow-hidden">
      {/* Top bar — matches MainContent.tsx's header convention exactly */}
      <div className="h-[52px] flex items-center px-4 drag shrink-0">
        <div className="flex items-center gap-1 no-drag min-w-0">
          <button
            onClick={closeFilePreview}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-neutral-500 hover:text-neutral-300"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="text-xs text-text-tertiary truncate" title={previewFile.relativePath}>
            {fileName}
          </span>
        </div>
        <div className="flex-1" />
        <button
          onClick={toggleRightPanel}
          className={`p-1.5 rounded-lg hover:bg-white/5 transition-colors no-drag ${
            rightPanelOpen ? 'text-neutral-200' : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          <PanelRightOpen size={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto min-h-0">
        {state.loading ? (
          <div className="p-4 text-sm text-text-tertiary">加载中...</div>
        ) : state.reason === 'binary' ? (
          <div className="p-4 text-sm text-text-tertiary">(二进制文件，未预览)</div>
        ) : state.reason === 'too-large' ? (
          <div className="p-4 text-sm text-text-tertiary">(文件过大，未预览)</div>
        ) : state.reason === 'not-found' ? (
          <div className="p-4 text-sm text-text-tertiary">(文件不存在)</div>
        ) : (
          <SyntaxHighlighter
            language={getLanguageForFilename(fileName)}
            style={vscDarkPlus}
            showLineNumbers
            customStyle={{
              margin: 0,
              padding: '1rem',
              background: 'transparent',
              fontSize: '12.5px',
              minHeight: '100%',
            }}
          >
            {state.content ?? ''}
          </SyntaxHighlighter>
        )}
      </div>
    </main>
  );
}
