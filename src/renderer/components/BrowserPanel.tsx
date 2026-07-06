import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, RotateCw, Globe } from 'lucide-react';

// Deliberately starts with no URL loaded — see CCodeBox's "honest empty over fabricated
// placeholder" convention rather than guessing a default site to preview.
export function BrowserPanel() {
  const webviewRef = useRef<Electron.WebviewTag>(null);
  const [urlInput, setUrlInput] = useState('');
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const navigate = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    const normalized = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    setActiveUrl(normalized);
    setUrlInput(normalized);
  };

  const goBack = () => webviewRef.current?.goBack();
  const goForward = () => webviewRef.current?.goForward();
  const reload = () => webviewRef.current?.reload();

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const syncHistoryState = (url: string) => {
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
      setUrlInput(url);
    };
    const handleDidNavigate = (e: Electron.DidNavigateEvent) => syncHistoryState(e.url);
    const handleDidNavigateInPage = (e: Electron.DidNavigateInPageEvent) => syncHistoryState(e.url);
    const handleStartLoading = () => setIsLoading(true);
    const handleStopLoading = () => setIsLoading(false);

    webview.addEventListener('did-navigate', handleDidNavigate);
    webview.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
    webview.addEventListener('did-start-loading', handleStartLoading);
    webview.addEventListener('did-stop-loading', handleStopLoading);

    return () => {
      webview.removeEventListener('did-navigate', handleDidNavigate);
      webview.removeEventListener('did-navigate-in-page', handleDidNavigateInPage);
      webview.removeEventListener('did-start-loading', handleStartLoading);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
    };
    // activeUrl transitions null -> non-null exactly once, when the webview element first
    // mounts (see the ternary below) — re-run the listener setup only at that transition,
    // by which point the ref is guaranteed populated.
  }, [activeUrl !== null]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-card-border shrink-0">
        <button
          onClick={goBack}
          disabled={!canGoBack}
          className="p-1.5 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-neutral-200 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-neutral-400"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={goForward}
          disabled={!canGoForward}
          className="p-1.5 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-neutral-200 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-neutral-400"
        >
          <ChevronRight size={14} />
        </button>
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate();
          }}
          placeholder="输入网址..."
          className="flex-1 min-w-0 bg-white/5 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 outline-none placeholder:text-text-tertiary"
        />
        <button
          onClick={navigate}
          className="p-1.5 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-neutral-200 transition-colors shrink-0"
        >
          <ArrowRight size={14} />
        </button>
        {activeUrl && (
          <button
            onClick={reload}
            className="p-1.5 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-neutral-200 transition-colors shrink-0"
          >
            <RotateCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 bg-black/20">
        {activeUrl ? (
          <webview ref={webviewRef} src={activeUrl} className="w-full h-full" />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-text-tertiary">
            <Globe size={28} />
            <span className="text-xs">输入网址并回车以预览</span>
          </div>
        )}
      </div>
    </div>
  );
}
