import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';
import type { TerminalEvent } from '../../shared/ipc';

const DEFAULT_SHELL = process.env.SHELL || '/bin/zsh';

export class TerminalManager {
  private readonly terminals = new Map<string, IPty>();

  constructor(private readonly onEvent: (event: TerminalEvent) => void) {}

  create(cwd: string, cols: number, rows: number): string {
    const terminalId = randomUUID();
    const term = pty.spawn(DEFAULT_SHELL, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>,
    });

    this.terminals.set(terminalId, term);
    term.onData((data) => this.onEvent({ kind: 'data', terminalId, data }));
    term.onExit(({ exitCode }) => {
      this.onEvent({ kind: 'exit', terminalId, exitCode });
      this.terminals.delete(terminalId);
    });

    return terminalId;
  }

  write(terminalId: string, data: string): void {
    this.terminals.get(terminalId)?.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    // Races against an already-exited pty (e.g. shell exited right as a resize was in
    // flight) throw synchronously — safe to ignore since there's nothing left to resize.
    try {
      this.terminals.get(terminalId)?.resize(cols, rows);
    } catch {
      // ignore
    }
  }

  dispose(terminalId: string): void {
    this.terminals.get(terminalId)?.kill();
    this.terminals.delete(terminalId);
  }

  disposeAll(): void {
    for (const term of this.terminals.values()) term.kill();
    this.terminals.clear();
  }
}
