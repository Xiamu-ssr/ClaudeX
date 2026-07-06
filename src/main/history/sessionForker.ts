import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { computeForkCutoffs } from './historyReader';
import { registerFork } from './forkRegistry';
import type { ForkSessionResponse } from '../../shared/ipc';

const DEFAULT_CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

function claudeProjectsDir(): string {
  return process.env.CCODEBOX_PROJECTS_DIR || DEFAULT_CLAUDE_PROJECTS_DIR;
}

function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

// Truncates a copy of the source session's .jsonl at the given turn's cutoff and rewrites
// every kept line's sessionId to a freshly generated id, so the copy can be opened via the
// ordinary --resume flow as an independent session. The source file is never modified.
export function forkSession(
  cwd: string,
  sourceSessionId: string,
  turnIndex: number,
  projectsDir: string = claudeProjectsDir(),
  forkRegistryPath?: string
): ForkSessionResponse {
  const cutoffs = computeForkCutoffs(cwd, sourceSessionId, projectsDir);
  const cutoff = cutoffs.find((c) => c.turnIndex === turnIndex);
  if (!cutoff) return { ok: false, message: '找不到可分叉的对话轮次' };

  const dirPath = path.join(projectsDir, encodeCwd(cwd));
  const sourcePath = path.join(dirPath, `${sourceSessionId}.jsonl`);
  const lines = fs.readFileSync(sourcePath, 'utf8').split('\n').filter((l) => l.trim());
  const newSessionId = randomUUID();

  const rewritten =
    lines
      .slice(0, cutoff.lineCount)
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
          parsed.sessionId = newSessionId;
          return JSON.stringify(parsed);
        } catch {
          return raw; // leave any unparseable line byte-for-byte unchanged rather than dropping it
        }
      })
      .join('\n') + '\n';

  fs.writeFileSync(path.join(dirPath, `${newSessionId}.jsonl`), rewritten);

  registerFork(
    newSessionId,
    { forkedFromSessionId: sourceSessionId, forkedAtTurnIndex: turnIndex, cwd, createdAt: new Date().toISOString() },
    forkRegistryPath
  );

  return { ok: true, newSessionId };
}
