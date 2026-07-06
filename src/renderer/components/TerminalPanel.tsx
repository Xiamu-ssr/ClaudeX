import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  cwd: string;
}

export function TerminalPanel({ cwd }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      cursorBlink: true,
      theme: { background: '#212123', foreground: '#e5e5e7' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    let terminalId: string | null = null;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    window.electronAPI.claude.createTerminal({ cwd, cols: term.cols, rows: term.rows }).then((res) => {
      if (disposed) {
        window.electronAPI.claude.disposeTerminal({ terminalId: res.terminalId });
        return;
      }
      terminalId = res.terminalId;
      unsubscribe = window.electronAPI.claude.onTerminalEvent((event) => {
        if (event.terminalId !== terminalId) return;
        if (event.kind === 'data') term.write(event.data);
        if (event.kind === 'exit') term.write(`\r\n\x1b[90m[进程已退出，退出码 ${event.exitCode}]\x1b[0m\r\n`);
      });
    });

    const dataDisposable = term.onData((data) => {
      if (terminalId) window.electronAPI.claude.writeTerminal({ terminalId, data });
    });

    // Fires on real container resizes and also on the display:none -> visible
    // transition when the user switches back to this tab, so no separate
    // "became active" handling is needed.
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (terminalId) window.electronAPI.claude.resizeTerminal({ terminalId, cols: term.cols, rows: term.rows });
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      unsubscribe?.();
      if (terminalId) window.electronAPI.claude.disposeTerminal({ terminalId });
      term.dispose();
    };
  }, [cwd]);

  return <div ref={containerRef} className="h-full w-full px-2 py-1.5 overflow-hidden" />;
}
