import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyLine, createTurnAccumulator, type ClaudeStdoutLine } from '../../shared/eventTranslator';
import type { AssistantTurn, ChatMessage, Session } from '../../shared/chat';
import type { ProjectSummary, SessionListEntry } from '../../shared/ipc';
import { readProjectOverrides } from './projectOverrides';
import { readSessionOverrides } from './sessionOverrides';


const DEFAULT_CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const TITLE_MAX_LENGTH = 24;
const PEEK_BYTES = 8192;

// Tests inject a fixture directory via CCODEBOX_PROJECTS_DIR (see tests/fixtures/claude-projects)
// rather than reading/writing the developer's real ~/.claude/projects.
function claudeProjectsDir(): string {
  return process.env.CCODEBOX_PROJECTS_DIR || DEFAULT_CLAUDE_PROJECTS_DIR;
}

function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function readLeadingBytes(filePath: string, maxBytes: number): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function findCwdInJsonlFile(filePath: string): string | null {
  const text = readLeadingBytes(filePath, PEEK_BYTES);
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.cwd === 'string') return parsed.cwd;
    } catch {
      continue; // possibly a line truncated at the byte-peek boundary
    }
  }
  return null;
}

function truncateTitle(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > TITLE_MAX_LENGTH ? `${singleLine.slice(0, TITLE_MAX_LENGTH)}...` : singleLine;
}

function deriveSessionTitle(filePath: string): string {
  const text = readLeadingBytes(filePath, PEEK_BYTES);
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const message = parsed.message as { content?: unknown } | undefined;
    if (parsed.type === 'user' && !parsed.isMeta && typeof message?.content === 'string') {
      return truncateTitle(message.content);
    }
  }
  return '(空会话)';
}

export function listProjectDirs(
  projectsDir: string = claudeProjectsDir(),
  overridesPath?: string
): ProjectSummary[] {
  if (!fs.existsSync(projectsDir)) return [];

  const dirs = fs
    .readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const overrides = readProjectOverrides(overridesPath);
  const summaries: ProjectSummary[] = [];

  for (const dirName of dirs) {
    const dirPath = path.join(projectsDir, dirName);
    const jsonlFiles = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    if (jsonlFiles.length === 0) continue;

    let cwd: string | null = null;
    let lastActiveAt: string | null = null;
    let latestMtime = 0;

    for (const file of jsonlFiles) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        lastActiveAt = stat.mtime.toISOString();
      }
      if (!cwd) cwd = findCwdInJsonlFile(filePath);
    }

    if (!cwd) continue; // no parseable message lines found; skip rather than guess from dir name

    const override = overrides[cwd];
    if (override?.removed) continue;

    summaries.push({
      encodedDirName: dirName,
      cwd,
      displayName: override?.customName ?? path.basename(cwd),
      sessionCount: jsonlFiles.length,
      lastActiveAt,
      pinned: override?.pinned ?? false,
      collapsed: override?.collapsed ?? false,
    });
  }

  return summaries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '');
  });
}

export function listSessionsInProject(
  cwd: string,
  projectsDir: string = claudeProjectsDir(),
  sessionOverridesPath?: string
): SessionListEntry[] {
  const dirPath = path.join(projectsDir, encodeCwd(cwd));
  if (!fs.existsSync(dirPath)) return [];

  const overrides = readSessionOverrides(sessionOverridesPath);
  const jsonlFiles = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
  const entries: SessionListEntry[] = jsonlFiles
    .map((file) => {
      const sessionId = file.replace(/\.jsonl$/, '');
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      return {
        sessionId,
        title: deriveSessionTitle(filePath),
        lastActiveAt: stat.mtime.toISOString(),
        cwd,
      };
    })
    .filter((entry) => {
      const override = overrides[entry.sessionId];
      return !override?.removed && !override?.archived;
    });

  return entries.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

export function isTurnBoundaryLine(parsed: any): boolean {
  if (!parsed || parsed.type !== 'user' || parsed.isMeta) return false;
  const content = (parsed.message as { content?: unknown } | undefined)?.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content) && content.length > 0) {
    // Tool-result replies are synthetic array-content 'user' lines the CLI emits
    // after a tool call, not an actual new user turn. Real user turns with
    // attachments or forked sessions also produce array content, but never mix
    // in tool_result blocks.
    return content.every((block) => block && typeof block === 'object' && (block as { type?: unknown }).type !== 'tool_result');
  }
  return false;
}

export interface ForkCutoff {
  turnIndex: number;
  lineCount: number;
}

// One cutoff per user turn boundary in the file, in file order. `lineCount` is how many
// leading lines to keep to capture that turn complete (through its assistant response/tool
// calls) without spilling into the next user turn — i.e. the slice point a fork should
// truncate at. Uses the same isTurnBoundaryLine predicate the live UI's turn counter is
// built from, so a turn index picked in the UI can never map to a different cutoff here.
export function computeForkCutoffs(
  cwd: string,
  sessionId: string,
  projectsDir: string = claudeProjectsDir()
): ForkCutoff[] {
  const filePath = path.join(projectsDir, encodeCwd(cwd), `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim());
  const boundaryIndices: number[] = [];
  lines.forEach((raw, i) => {
    try {
      if (isTurnBoundaryLine(JSON.parse(raw))) boundaryIndices.push(i);
    } catch {
      // skip unparseable lines, consistent with loadHistoricalSession/deriveSessionTitle above
    }
  });

  return boundaryIndices.map((_startIdx, turnIndex) => ({
    turnIndex,
    lineCount: boundaryIndices[turnIndex + 1] ?? lines.length,
  }));
}

function jsonlLineToStreamLine(jsonlLine: Record<string, unknown>): ClaudeStdoutLine | null {
  if (jsonlLine.type === 'assistant') {
    return { type: 'assistant', message: jsonlLine.message as ClaudeStdoutLine['message'] };
  }
  if (jsonlLine.type === 'user' && Array.isArray((jsonlLine.message as { content?: unknown })?.content)) {
    return { type: 'user', message: jsonlLine.message as ClaudeStdoutLine['message'] };
  }
  return null; // mode, permission-mode, file-history-snapshot, queue-operation, attachment, last-prompt, etc.
}

export function loadHistoricalSession(
  cwd: string,
  sessionId: string,
  projectsDir: string = claudeProjectsDir()
): Session {
  const filePath = path.join(projectsDir, encodeCwd(cwd), `${sessionId}.jsonl`);
  const content = fs.readFileSync(filePath, 'utf8');

  const messages: ChatMessage[] = [];
  let currentAcc: ReturnType<typeof createTurnAccumulator> | null = null;
  let currentTurn: AssistantTurn | null = null;

  for (const rawLine of content.split('\n')) {
    if (!rawLine.trim()) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      continue;
    }

    const message = parsed.message as { content?: unknown } | undefined;

    // A real user text line starts a new turn boundary. File order is chronological
    // (JSONL is append-only), so we replay in file order rather than following
    // parentUuid chains — sufficient for the simple, non-branching common case.
    if (isTurnBoundaryLine(parsed)) {
      messages.push({ role: 'user', content: typeof message?.content === 'string' ? message.content : '' });
      currentAcc = createTurnAccumulator();
      currentTurn = { processingTime: 0, steps: [], response: '', isProcessing: false };
      messages.push({ role: 'assistant', turn: currentTurn });
      continue;
    }

    if (!currentAcc || !currentTurn) continue;

    const streamLine = jsonlLineToStreamLine(parsed);
    if (!streamLine) continue;

    const { deltas } = applyLine(currentAcc, streamLine);
    for (const delta of deltas) {
      switch (delta.kind) {
        case 'step-appended':
          currentTurn.steps.push(delta.step);
          break;
        case 'step-updated':
          currentTurn.steps[delta.index] = delta.step;
          break;
        case 'response-updated':
          currentTurn.response = delta.response;
          break;
      }
    }
  }

  return {
    id: sessionId,
    cwd,
    title: deriveSessionTitle(filePath),
    projectName: path.basename(cwd),
    lastActiveTime: '',
    messages,
  };
}
