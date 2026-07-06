import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { forkSession } from '../src/main/history/sessionForker';
import { readForkRegistry } from '../src/main/history/forkRegistry';
import { listSessionsInProject } from '../src/main/history/historyReader';

function makeTempProjectsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-fork-test-'));
}

function writeSessionFile(projectsDir: string, encodedDir: string, sessionId: string, lines: object[]) {
  const dirPath = path.join(projectsDir, encodedDir);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, `${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('forkSession truncates at the given turn and rewrites sessionId on every kept line', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  const registryPath = path.join(projectsDir, 'fork-registry.json');
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'first question' }, cwd, uuid: 'u1', sessionId: 'session-1' },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] }, uuid: 'a1', sessionId: 'session-1' },
      { type: 'user', message: { role: 'user', content: 'second question' }, cwd, uuid: 'u2', sessionId: 'session-1' },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'second answer' }] }, uuid: 'a2', sessionId: 'session-1' },
    ]);

    const result = forkSession(cwd, 'session-1', 0, projectsDir, registryPath);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.newSessionId) throw new Error('expected a successful fork');

    const newFilePath = path.join(projectsDir, '-Users-test-proj', `${result.newSessionId}.jsonl`);
    const newLines = fs.readFileSync(newFilePath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    expect(newLines).toHaveLength(2);
    expect(newLines.every((l) => l.sessionId === result.newSessionId)).toBe(true);
    expect(newLines[0].message.content).toBe('first question');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('forkSession leaves the source .jsonl file byte-for-byte unchanged', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  const registryPath = path.join(projectsDir, 'fork-registry.json');
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'first question' }, cwd, uuid: 'u1', sessionId: 'session-1' },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] }, uuid: 'a1', sessionId: 'session-1' },
    ]);
    const sourcePath = path.join(projectsDir, '-Users-test-proj', 'session-1.jsonl');
    const before = fs.readFileSync(sourcePath, 'utf8');

    forkSession(cwd, 'session-1', 0, projectsDir, registryPath);

    expect(fs.readFileSync(sourcePath, 'utf8')).toBe(before);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('forkSession registers the new session in the fork registry sidecar', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  const registryPath = path.join(projectsDir, 'fork-registry.json');
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'first question' }, cwd, uuid: 'u1', sessionId: 'session-1' },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] }, uuid: 'a1', sessionId: 'session-1' },
    ]);

    const result = forkSession(cwd, 'session-1', 0, projectsDir, registryPath);
    if (!result.ok || !result.newSessionId) throw new Error('expected a successful fork');

    const registry = readForkRegistry(registryPath);
    const record = registry[result.newSessionId];
    expect(record.forkedFromSessionId).toBe('session-1');
    expect(record.forkedAtTurnIndex).toBe(0);
    expect(record.cwd).toBe(cwd);
    expect(typeof record.createdAt).toBe('string');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('forkSession returns ok:false for an out-of-range turnIndex', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  const registryPath = path.join(projectsDir, 'fork-registry.json');
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'only question' }, cwd, uuid: 'u1', sessionId: 'session-1' },
    ]);

    const result = forkSession(cwd, 'session-1', 5, projectsDir, registryPath);
    expect(result.ok).toBe(false);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('the forked session is discoverable via listSessionsInProject like any other session', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  const registryPath = path.join(projectsDir, 'fork-registry.json');
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'first question' }, cwd, uuid: 'u1', sessionId: 'session-1' },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] }, uuid: 'a1', sessionId: 'session-1' },
    ]);

    const result = forkSession(cwd, 'session-1', 0, projectsDir, registryPath);
    if (!result.ok || !result.newSessionId) throw new Error('expected a successful fork');

    const sessions = listSessionsInProject(cwd, projectsDir);
    expect(sessions.map((s) => s.sessionId).sort()).toEqual(['session-1', result.newSessionId].sort());
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});
