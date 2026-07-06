import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getGitStatus, getGitWorktrees, getGitDiff, parseWorktreePorcelain, createWorktree } from '../src/main/system/git';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeTempRepo(): string {
  const dir = makeTempDir('ccodebox-git-test-');
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email test@test.com', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  execSync('git add a.txt', { cwd: dir });
  execSync('git commit -q -m initial', { cwd: dir });
  return dir;
}

test('getGitStatus reports isRepo: false for a plain non-repo directory', async () => {
  const dir = makeTempDir('ccodebox-git-test-plain-');
  try {
    expect(await getGitStatus(dir)).toEqual({ isRepo: false });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getGitStatus reports the real branch, dirty count, and no-upstream for a fresh local repo', async () => {
  const dir = makeTempRepo();
  try {
    fs.writeFileSync(path.join(dir, 'b.txt'), 'uncommitted');
    const status = await getGitStatus(dir);

    expect(status.isRepo).toBe(true);
    expect(status.branch).toMatch(/^(main|master)$/);
    expect(status.ahead).toBeUndefined();
    expect(status.behind).toBeUndefined();
    expect(status.dirtyCount).toBe(1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getGitStatus reports a clean dirtyCount of 0 right after a commit', async () => {
  const dir = makeTempRepo();
  try {
    const status = await getGitStatus(dir);
    expect(status.dirtyCount).toBe(0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getGitWorktrees lists just the main worktree for a plain repo with no extras', async () => {
  const dir = makeTempRepo();
  try {
    const result = await getGitWorktrees(dir);
    expect(result.isRepo).toBe(true);
    expect(result.worktrees).toHaveLength(1);
    expect(result.worktrees[0].isMain).toBe(true);
    expect(result.worktrees[0].path).toBe(fs.realpathSync(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getGitWorktrees lists an additional worktree together with its branch', async () => {
  const dir = makeTempRepo();
  const worktreeDir = makeTempDir('ccodebox-git-test-wt-');
  fs.rmSync(worktreeDir, { recursive: true, force: true }); // `git worktree add` requires the target not to already exist
  try {
    execSync(`git worktree add -q -b feature-branch ${JSON.stringify(worktreeDir)}`, { cwd: dir });

    const result = await getGitWorktrees(dir);
    expect(result.worktrees).toHaveLength(2);
    const extra = result.worktrees.find((w) => !w.isMain);
    expect(extra?.branch).toBe('feature-branch');
    expect(extra?.path).toBe(fs.realpathSync(worktreeDir));
  } finally {
    try {
      execSync(`git worktree remove --force ${JSON.stringify(worktreeDir)}`, { cwd: dir });
    } catch {
      // best-effort — the unconditional rmSync below cleans up either way
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  }
});

test('getGitWorktrees reports isRepo: false for a plain non-repo directory', async () => {
  const dir = makeTempDir('ccodebox-git-test-plain-wt-');
  try {
    expect(await getGitWorktrees(dir)).toEqual({ isRepo: false, worktrees: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseWorktreePorcelain parses a real multi-worktree --porcelain block, including a detached one', () => {
  const output = [
    'worktree /repo/main',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree /repo/wt-feature',
    'HEAD def456',
    'branch refs/heads/feature-x',
    '',
    'worktree /repo/wt-detached',
    'HEAD ghi789',
    'detached',
    '',
  ].join('\n');

  expect(parseWorktreePorcelain(output)).toEqual([
    { path: '/repo/main', branch: 'main', isMain: true },
    { path: '/repo/wt-feature', branch: 'feature-x', isMain: false },
    { path: '/repo/wt-detached', branch: null, isMain: false },
  ]);
});

test('parseWorktreePorcelain returns an empty list for empty output', () => {
  expect(parseWorktreePorcelain('')).toEqual([]);
});

test('getGitDiff reports isRepo: false for a plain non-repo directory', async () => {
  const dir = makeTempDir('ccodebox-git-test-diff-plain-');
  try {
    expect(await getGitDiff(dir)).toEqual({ isRepo: false, files: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getGitDiff classifies modified/added/deleted/untracked files with real diff content', async () => {
  const dir = makeTempRepo();
  try {
    fs.writeFileSync(path.join(dir, 'modified.txt'), 'original\n');
    fs.writeFileSync(path.join(dir, 'deleted.txt'), 'bye\n');
    execSync('git add modified.txt deleted.txt', { cwd: dir });
    execSync('git commit -q -m setup', { cwd: dir });

    fs.writeFileSync(path.join(dir, 'modified.txt'), 'changed\n');
    fs.rmSync(path.join(dir, 'deleted.txt'));
    fs.writeFileSync(path.join(dir, 'added.txt'), 'new file\n');
    execSync('git add added.txt deleted.txt', { cwd: dir });
    fs.writeFileSync(path.join(dir, 'untracked.txt'), 'untracked content\nsecond line\n');

    const { isRepo, files } = await getGitDiff(dir);
    expect(isRepo).toBe(true);
    expect(files).toHaveLength(4); // a.txt from makeTempRepo's initial commit is untouched and clean

    const modified = files.find((f) => f.path === 'modified.txt');
    expect(modified?.status).toBe('modified');
    expect(modified?.diff).toContain('-original');
    expect(modified?.diff).toContain('+changed');

    const deleted = files.find((f) => f.path === 'deleted.txt');
    expect(deleted?.status).toBe('deleted');
    expect(deleted?.staged).toBe(true);

    const added = files.find((f) => f.path === 'added.txt');
    expect(added?.status).toBe('added');
    expect(added?.staged).toBe(true);

    const untracked = files.find((f) => f.path === 'untracked.txt');
    expect(untracked?.status).toBe('untracked');
    expect(untracked?.staged).toBe(false);
    // Regression check for a real bug: the untracked-file preview used to leave a stray
    // trailing '+' line for content ending in a newline.
    expect(untracked?.diff).toBe('+untracked content\n+second line');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getGitDiff reports a binary untracked file as unpreviewed rather than dumping raw bytes', async () => {
  const dir = makeTempRepo();
  try {
    fs.writeFileSync(path.join(dir, 'binary.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
    const { files } = await getGitDiff(dir);
    const binaryFile = files.find((f) => f.path === 'binary.bin');
    expect(binaryFile?.diff).toBe('(二进制文件，未预览)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createWorktree creates a real sibling worktree with a new branch', async () => {
  const dir = makeTempRepo();
  let worktreePath: string | undefined;
  try {
    const result = await createWorktree(dir, 'feature-x');
    expect(result.ok).toBe(true);
    worktreePath = result.worktreePath;
    expect(worktreePath).toBeDefined();
    expect(fs.existsSync(worktreePath!)).toBe(true);

    const worktrees = await getGitWorktrees(dir);
    const extra = worktrees.worktrees.find((w) => !w.isMain);
    expect(extra?.branch).toBe('feature-x');
  } finally {
    if (worktreePath) {
      try {
        execSync(`git worktree remove --force ${JSON.stringify(worktreePath)}`, { cwd: dir });
      } catch {
        // best-effort — the unconditional rmSync below cleans up either way
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createWorktree fails gracefully for a non-repo directory', async () => {
  const dir = makeTempDir('ccodebox-git-test-wt-plain-');
  try {
    const result = await createWorktree(dir, 'feature-x');
    expect(result.ok).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createWorktree fails gracefully when the sibling target path already exists', async () => {
  const dir = makeTempRepo();
  const collidingPath = path.join(path.dirname(dir), `${path.basename(dir)}-feature-x`);
  fs.mkdirSync(collidingPath, { recursive: true });
  try {
    const result = await createWorktree(dir, 'feature-x');
    expect(result.ok).toBe(false);
    expect(result.message).toContain(collidingPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(collidingPath, { recursive: true, force: true });
  }
});
