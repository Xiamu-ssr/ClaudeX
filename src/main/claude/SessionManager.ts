import { ClaudeSession } from './ClaudeSession';
import type { ClaudeSessionEvent, EffortLevel, PermissionMode } from '../../shared/ipc';

export class SessionManager {
  private readonly sessions = new Map<string, ClaudeSession>();

  constructor(private readonly onEvent: (event: ClaudeSessionEvent) => void) {}

  create(opts: {
    sessionId: string;
    cwd: string;
    resumeSessionId?: string;
    permissionMode?: PermissionMode;
    model?: string;
    effort?: EffortLevel;
    extraEnv?: Record<string, string>;
    contextWindowTokens?: number;
  }): ClaudeSession {
    const session = new ClaudeSession({ ...opts, onEvent: this.onEvent });
    this.sessions.set(opts.sessionId, session);
    session.start();
    return session;
  }

  get(sessionId: string): ClaudeSession | undefined {
    return this.sessions.get(sessionId);
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  stopAll(): void {
    for (const session of this.sessions.values()) session.stop();
    this.sessions.clear();
  }
}
