import { spawn, execSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  applyLine,
  createTurnAccumulator,
  type ClaudeStdoutLine,
  type TurnAccumulator,
  type TurnDelta,
} from '../../shared/eventTranslator';
import { NdjsonLineSplitter } from '../../shared/ndjson';
import type { AssistantTurn, ChatMessage } from '../../shared/chat';
import type { ClaudeSessionEvent, EffortLevel, OutgoingAttachment, PermissionMode } from '../../shared/ipc';

export interface ClaudeSessionOptions {
  sessionId: string;
  cwd: string;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
  model?: string;
  effort?: EffortLevel;
  extraEnv?: Record<string, string>;
  onEvent: (event: ClaudeSessionEvent) => void;
}

// Electron apps (especially launched via Finder/Dock) often inherit a minimal PATH that
// doesn't include nvm/homebrew bin dirs, and even when a `claude` IS found on PATH, multiple
// installs (e.g. a broken Homebrew shim shadowing a working nvm-managed one) can shadow the
// working binary depending on PATH order. Resolve via the user's actual login shell once,
// which sources their real shell rc files and reflects what `claude` resolves to interactively.
let cachedClaudeBinary: string | null = null;

export function resolveClaudeBinary(): string {
  if (process.env.CCODEBOX_CLAUDE_BIN) return process.env.CCODEBOX_CLAUDE_BIN;
  if (cachedClaudeBinary) return cachedClaudeBinary;

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const output = execSync(`${shell} -lic 'command -v claude'`, { encoding: 'utf8' });
    // An interactive login shell can print extra noise around the actual output (session
    // save/restore messages, MOTD, plugin banners, etc.) — only trust a line that looks
    // like an actual absolute path, not the whole captured blob.
    const pathLine = output.split('\n').map((l) => l.trim()).find((l) => l.startsWith('/'));
    if (pathLine) {
      cachedClaudeBinary = pathLine;
      return pathLine;
    }
  } catch {
    // fall through — let spawn's own PATH resolution try as a last resort
  }
  return 'claude';
}

export class ClaudeSession {
  readonly sessionId: string;
  readonly cwd: string;
  private readonly resumeSessionId?: string;
  private readonly permissionMode: PermissionMode;
  private readonly model?: string;
  private readonly effort?: EffortLevel;
  private readonly extraEnv: Record<string, string>;
  private readonly onEvent: (event: ClaudeSessionEvent) => void;

  private proc: ChildProcessWithoutNullStreams | null = null;
  private readonly splitter = new NdjsonLineSplitter();
  private currentAcc: TurnAccumulator | null = null;

  messages: ChatMessage[] = [];

  constructor(opts: ClaudeSessionOptions) {
    this.sessionId = opts.sessionId;
    this.cwd = opts.cwd;
    this.resumeSessionId = opts.resumeSessionId;
    this.permissionMode = opts.permissionMode ?? 'bypassPermissions';
    this.model = opts.model;
    this.effort = opts.effort;
    this.extraEnv = opts.extraEnv ?? {};
    this.onEvent = opts.onEvent;
  }

  start(): void {
    const bin = resolveClaudeBinary();
    const args = [
      '-p',
      '--verbose',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--replay-user-messages',
      '--permission-mode',
      this.permissionMode,
    ];
    if (this.resumeSessionId) {
      args.push('--resume', this.resumeSessionId);
    } else {
      args.push('--session-id', this.sessionId);
    }
    if (this.model) {
      args.push('--model', this.model);
    }
    if (this.effort) {
      args.push('--effort', this.effort);
    }

    this.proc = spawn(bin, args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.extraEnv },
    });

    this.proc.stdout.on('data', (chunk: Buffer) => this.onStdoutChunk(chunk));
    this.proc.stderr.on('data', (chunk: Buffer) => {
      this.onEvent({ kind: 'process-error', sessionId: this.sessionId, message: chunk.toString('utf8') });
    });
    this.proc.on('exit', (code) => {
      this.onEvent({ kind: 'process-exited', sessionId: this.sessionId, code });
    });
    this.proc.on('error', (err) => {
      this.onEvent({ kind: 'process-error', sessionId: this.sessionId, message: err.message });
    });
  }

  sendUserMessage(text: string, attachments?: OutgoingAttachment[]): void {
    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error('ClaudeSession process is not running');
    }

    this.messages.push({ role: 'user', content: text });
    this.currentAcc = createTurnAccumulator();
    this.messages.push({
      role: 'assistant',
      turn: { processingTime: 0, steps: [], response: '', isProcessing: true },
    });

    // Only shift to array-shaped content when attachments are present — the plain-string path
    // (and every existing test/fixture built around it) stays completely unchanged otherwise.
    const content =
      attachments && attachments.length > 0
        ? [
            { type: 'text', text },
            ...attachments.map((a) => ({
              type: 'image',
              source: { type: 'base64', media_type: a.mimeType, data: a.base64Data },
            })),
          ]
        : text;

    const line = JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
    this.proc.stdin.write(line);
  }

  // Returns once the child process has actually exited, not just once stdin has been
  // closed — callers that respawn with --resume (e.g. mid-conversation model switches)
  // need the old process to have fully flushed its session .jsonl before starting a new
  // one against the same session id, or the new process could read stale/partial state.
  stop(): Promise<void> {
    if (!this.proc) return Promise.resolve();
    return new Promise((resolve) => {
      this.proc!.once('exit', () => resolve());
      this.proc!.stdin.end();
    });
  }

  private onStdoutChunk(chunk: Buffer): void {
    for (const line of this.splitter.push(chunk.toString('utf8'))) {
      this.handleLine(line);
    }
  }

  private handleLine(rawLine: string): void {
    let parsed: ClaudeStdoutLine;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      return;
    }

    if (!this.currentAcc) this.currentAcc = createTurnAccumulator();
    const currentTurn = this.getCurrentTurn();
    const { deltas, turnComplete } = applyLine(this.currentAcc, parsed);

    for (const delta of deltas) this.applyDeltaToLocalState(currentTurn, delta);
    if (turnComplete) this.finishTurn(currentTurn, turnComplete.processingTime, turnComplete.isError);
  }

  private getCurrentTurn(): AssistantTurn {
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== 'assistant') {
      const turn: AssistantTurn = { processingTime: 0, steps: [], response: '', isProcessing: true };
      this.messages.push({ role: 'assistant', turn });
      return turn;
    }
    return last.turn;
  }

  private applyDeltaToLocalState(turn: AssistantTurn, delta: TurnDelta): void {
    switch (delta.kind) {
      case 'step-appended':
        turn.steps.push(delta.step);
        this.onEvent({ kind: 'turn-step-appended', sessionId: this.sessionId, step: delta.step });
        break;
      case 'step-updated':
        turn.steps[delta.index] = delta.step;
        this.onEvent({ kind: 'turn-step-updated', sessionId: this.sessionId, index: delta.index, step: delta.step });
        break;
      case 'response-updated':
        turn.response = delta.response;
        this.onEvent({ kind: 'turn-response-updated', sessionId: this.sessionId, response: delta.response });
        break;
    }
  }

  private finishTurn(turn: AssistantTurn, processingTime: number, isError?: boolean): void {
    turn.isProcessing = false;
    turn.processingTime = processingTime;
    turn.isError = isError;
    this.currentAcc = null;
    this.onEvent({ kind: 'turn-completed', sessionId: this.sessionId, processingTime, isError });
  }
}
