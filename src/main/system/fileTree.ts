import fs from 'node:fs';
import path from 'node:path';
import type { FileTreeEntry, ListDirEntriesResponse, GetFilePreviewResponse } from '../../shared/ipc';

const MAX_PREVIEW_BYTES = 200_000;
const IGNORED_NAMES = new Set(['node_modules', '.git', 'dist', 'build', '.vite', 'out']);

// Resolves relativePath against cwd and rejects anything that would escape it — including
// the classic prefix-collision bug where a naive `startsWith(resolvedCwd)` check would wrongly
// admit a sibling directory like `<cwd>-evil` just because it shares the same string prefix.
function resolveWithinCwd(cwd: string, relativePath: string): string | null {
  const resolvedCwd = path.resolve(cwd);
  const target = path.resolve(resolvedCwd, relativePath);
  if (target !== resolvedCwd && !target.startsWith(resolvedCwd + path.sep)) return null;
  return target;
}

export function listDirEntries(cwd: string, relativePath: string): ListDirEntriesResponse {
  const targetDir = resolveWithinCwd(cwd, relativePath);
  if (!targetDir || !fs.existsSync(targetDir)) return { entries: [] };

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(targetDir, { withFileTypes: true });
  } catch {
    return { entries: [] };
  }

  const entries: FileTreeEntry[] = dirents
    .filter((d) => !IGNORED_NAMES.has(d.name))
    .map((d) => ({
      name: d.name,
      relativePath: path.join(relativePath, d.name),
      isDirectory: d.isDirectory(),
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return { entries };
}

export function getFilePreview(cwd: string, relativePath: string): GetFilePreviewResponse {
  const targetPath = resolveWithinCwd(cwd, relativePath);
  if (!targetPath || !fs.existsSync(targetPath)) return { content: null, reason: 'not-found' };

  const stat = fs.statSync(targetPath);
  if (stat.size > MAX_PREVIEW_BYTES) return { content: null, reason: 'too-large' };

  const buf = fs.readFileSync(targetPath);
  if (buf.subarray(0, 8000).includes(0)) return { content: null, reason: 'binary' };

  return { content: buf.toString('utf-8') };
}
