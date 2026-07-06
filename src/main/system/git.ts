import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import type {
  GitStatusResponse,
  GitWorktreeEntry,
  GitWorktreesResponse,
  GitFileDiff,
  GetGitDiffResponse,
  CreateWorktreeResponse,
} from '../../shared/ipc';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const MAX_UNTRACKED_PREVIEW_BYTES = 200_000;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
  return stdout.trim();
}

// Unlike git() above, this only strips the trailing newline — porcelain status lines can
// legitimately start with a space (e.g. " M foo"), which a leading .trim() would eat and
// throw off every fixed-offset slice into the line.
async function gitPorcelain(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
  return stdout.replace(/\n$/, '');
}

async function isInsideWorkTree(cwd: string): Promise<boolean> {
  try {
    return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])) === 'true';
  } catch {
    return false;
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatusResponse> {
  if (!(await isInsideWorkTree(cwd))) return { isRepo: false };

  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => undefined);

  let ahead: number | undefined;
  let behind: number | undefined;
  try {
    const counts = await git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    const [a, b] = counts.split(/\s+/).map(Number);
    ahead = a;
    behind = b;
  } catch {
    // no upstream configured — leave ahead/behind undefined rather than guessing
  }

  const porcelain = await git(cwd, ['status', '--porcelain']).catch(() => '');
  const dirtyCount = porcelain ? porcelain.split('\n').filter(Boolean).length : 0;

  return { isRepo: true, branch, ahead, behind, dirtyCount };
}

export function parseWorktreePorcelain(output: string): GitWorktreeEntry[] {
  const entries: Array<{ path: string; branch: string | null }> = [];
  let current: { path: string; branch: string | null } | null = null;

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice('worktree '.length), branch: null };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  if (current) entries.push(current);

  return entries.map((e, i) => ({ ...e, isMain: i === 0 }));
}

export async function getGitWorktrees(cwd: string): Promise<GitWorktreesResponse> {
  if (!(await isInsideWorkTree(cwd))) return { isRepo: false, worktrees: [] };

  try {
    const output = await git(cwd, ['worktree', 'list', '--porcelain']);
    return { isRepo: true, worktrees: parseWorktreePorcelain(output) };
  } catch {
    return { isRepo: true, worktrees: [] };
  }
}

function parseStatusPorcelain(output: string): Array<{ path: string; code: string }> {
  const entries: Array<{ path: string; code: string }> = [];
  for (const line of output.split('\n')) {
    if (!line) continue;
    const code = line.slice(0, 2);
    let filePath = line.slice(3);
    const renameSep = filePath.indexOf(' -> ');
    if (renameSep !== -1) filePath = filePath.slice(renameSep + 4);
    entries.push({ path: filePath, code });
  }
  return entries;
}

function classifyStatus(code: string): { status: GitFileDiff['status']; staged: boolean } {
  if (code === '??') return { status: 'untracked', staged: false };
  const [indexCh, workCh] = code;
  const staged = indexCh !== ' ' && indexCh !== '?';
  if (indexCh === 'R' || workCh === 'R') return { status: 'renamed', staged };
  if (indexCh === 'A') return { status: 'added', staged };
  if (indexCh === 'D' || workCh === 'D') return { status: 'deleted', staged };
  return { status: 'modified', staged };
}

// Untracked files have nothing for `git diff` to compare against, so this reads the
// working-tree content directly and formats it as an all-added preview instead.
async function untrackedFileDiff(cwd: string, filePath: string): Promise<string> {
  try {
    const buf = await readFile(path.join(cwd, filePath));
    if (buf.length > MAX_UNTRACKED_PREVIEW_BYTES) return `(文件过大，未预览，共 ${buf.length} 字节)`;
    if (buf.subarray(0, 8000).includes(0)) return '(二进制文件，未预览)';
    return buf
      .toString('utf-8')
      .replace(/\n$/, '')
      .split('\n')
      .map((l) => `+${l}`)
      .join('\n');
  } catch {
    return '';
  }
}

// `git diff HEAD` combines staged+unstaged changes for a tracked file in one pass; falls
// back for a repo that has no commits yet (HEAD doesn't resolve) or no staged changes.
async function trackedFileDiff(cwd: string, filePath: string): Promise<string> {
  try {
    return await git(cwd, ['diff', 'HEAD', '--', filePath]);
  } catch {
    try {
      return await git(cwd, ['diff', '--cached', '--', filePath]);
    } catch {
      return await git(cwd, ['diff', '--', filePath]).catch(() => '');
    }
  }
}

export async function getGitDiff(cwd: string): Promise<GetGitDiffResponse> {
  if (!(await isInsideWorkTree(cwd))) return { isRepo: false, files: [] };

  const porcelain = await gitPorcelain(cwd, ['status', '--porcelain']).catch(() => '');
  const entries = parseStatusPorcelain(porcelain);

  const files: GitFileDiff[] = await Promise.all(
    entries.map(async ({ path: filePath, code }) => {
      const { status, staged } = classifyStatus(code);
      const diff = status === 'untracked' ? await untrackedFileDiff(cwd, filePath) : await trackedFileDiff(cwd, filePath);
      return { path: filePath, status, staged, diff };
    })
  );

  return { isRepo: true, files };
}

function sanitizeBranchForPath(branch: string): string {
  return branch.replace(/[\\/:*?"<>|]/g, '-');
}

export async function createWorktree(cwd: string, branch: string): Promise<CreateWorktreeResponse> {
  if (!(await isInsideWorkTree(cwd))) {
    return { ok: false, message: '当前目录不是一个 Git 仓库' };
  }

  const worktreePath = path.join(path.dirname(cwd), `${path.basename(cwd)}-${sanitizeBranchForPath(branch)}`);
  if (fs.existsSync(worktreePath)) {
    return { ok: false, message: `目标路径已存在：${worktreePath}` };
  }

  try {
    await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd, timeout: GIT_TIMEOUT_MS });
    return { ok: true, worktreePath };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
