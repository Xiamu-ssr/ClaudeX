import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listDirEntries, getFilePreview } from '../src/main/system/fileTree';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('listDirEntries lists real files and directories, sorted directories-first then alphabetically', () => {
  const dir = makeTempDir('ccodebox-filetree-test-');
  try {
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    fs.mkdirSync(path.join(dir, 'z-dir'));

    const { entries } = listDirEntries(dir, '');
    expect(entries).toEqual([
      { name: 'z-dir', relativePath: 'z-dir', isDirectory: true },
      { name: 'a.txt', relativePath: 'a.txt', isDirectory: false },
      { name: 'b.txt', relativePath: 'b.txt', isDirectory: false },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listDirEntries filters out denylisted directory names', () => {
  const dir = makeTempDir('ccodebox-filetree-test-denylist-');
  try {
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, 'real.txt'), 'x');

    const { entries } = listDirEntries(dir, '');
    expect(entries).toEqual([{ name: 'real.txt', relativePath: 'real.txt', isDirectory: false }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listDirEntries lists a nested subdirectory by its relativePath', () => {
  const dir = makeTempDir('ccodebox-filetree-test-nested-');
  try {
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'nested.txt'), 'x');

    const { entries } = listDirEntries(dir, 'sub');
    expect(entries).toEqual([{ name: 'nested.txt', relativePath: path.join('sub', 'nested.txt'), isDirectory: false }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listDirEntries returns no entries for a relativePath that escapes cwd via ../', () => {
  const dir = makeTempDir('ccodebox-filetree-test-escape-');
  try {
    expect(listDirEntries(dir, '../../../etc')).toEqual({ entries: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listDirEntries returns no entries for a sibling directory sharing a name prefix (prefix-collision guard)', () => {
  const dir = makeTempDir('ccodebox-filetree-test-prefix-');
  const evilSibling = `${dir}-evil`;
  fs.mkdirSync(evilSibling);
  try {
    // A relativePath that resolves to `${dir}-evil` must NOT be treated as inside `dir`,
    // even though the string `${dir}-evil` starts with the string `dir`.
    const relativeToSibling = path.relative(dir, evilSibling);
    expect(listDirEntries(dir, relativeToSibling)).toEqual({ entries: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(evilSibling, { recursive: true, force: true });
  }
});

test('getFilePreview returns real file content for a small text file', () => {
  const dir = makeTempDir('ccodebox-filetree-test-preview-');
  try {
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world\n');
    expect(getFilePreview(dir, 'hello.txt')).toEqual({ content: 'hello world\n' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getFilePreview reports not-found for a nonexistent relative path', () => {
  const dir = makeTempDir('ccodebox-filetree-test-missing-');
  try {
    expect(getFilePreview(dir, 'nope.txt')).toEqual({ content: null, reason: 'not-found' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getFilePreview reports not-found rather than reading outside cwd for a path-traversal attempt', () => {
  const dir = makeTempDir('ccodebox-filetree-test-traversal-');
  try {
    expect(getFilePreview(dir, '../../../etc/passwd')).toEqual({ content: null, reason: 'not-found' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getFilePreview reports a binary file as unpreviewed rather than dumping raw bytes', () => {
  const dir = makeTempDir('ccodebox-filetree-test-binary-');
  try {
    fs.writeFileSync(path.join(dir, 'binary.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
    expect(getFilePreview(dir, 'binary.bin')).toEqual({ content: null, reason: 'binary' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getFilePreview reports too-large for a file exceeding the preview byte cap', () => {
  const dir = makeTempDir('ccodebox-filetree-test-large-');
  try {
    fs.writeFileSync(path.join(dir, 'big.txt'), Buffer.alloc(200_001, 'a'.charCodeAt(0)));
    expect(getFilePreview(dir, 'big.txt')).toEqual({ content: null, reason: 'too-large' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
