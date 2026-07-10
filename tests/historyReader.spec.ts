import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listProjectDirs, listSessionsInProject, loadHistoricalSession, computeForkCutoffs } from '../src/main/history/historyReader';

function makeTempProjectsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-history-test-'));
  return dir;
}

function writeSessionFile(projectsDir: string, encodedDir: string, sessionId: string, lines: object[]) {
  const dirPath = path.join(projectsDir, encodedDir);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, `${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('listProjectDirs finds real cwd via message line, not directory-name guessing', () => {
  const projectsDir = makeTempProjectsDir();
  try {
    writeSessionFile(projectsDir, '-Users-test-my-cool-app', 'session-1', [
      { type: 'mode', mode: 'normal', sessionId: 'session-1' },
      {
        type: 'user',
        message: { role: 'user', content: 'hello' },
        cwd: '/Users/test/my-cool-app', // dir name is ambiguous (my-cool-app has dashes), but cwd field is authoritative
        uuid: 'u1',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const projects = listProjectDirs(projectsDir);
    expect(projects).toHaveLength(1);
    expect(projects[0].cwd).toBe('/Users/test/my-cool-app');
    expect(projects[0].displayName).toBe('my-cool-app');
    expect(projects[0].sessionCount).toBe(1);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('listProjectDirs skips a project dir with no parseable message lines', () => {
  const projectsDir = makeTempProjectsDir();
  try {
    writeSessionFile(projectsDir, '-Users-test-empty', 'session-1', [
      { type: 'mode', mode: 'normal', sessionId: 'session-1' },
      { type: 'permission-mode', permissionMode: 'default', sessionId: 'session-1' },
    ]);

    expect(listProjectDirs(projectsDir)).toEqual([]);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('listSessionsInProject derives title from first real user text line, skipping isMeta lines', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-caveat>...' }, cwd, uuid: 'u0' },
      { type: 'user', message: { role: 'user', content: '这是真正的第一条消息，会被截断吗测试一下超过二十四个字符的标题' }, cwd, uuid: 'u1' },
    ]);

    const sessions = listSessionsInProject(cwd, projectsDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title.endsWith('...')).toBe(true);
    expect(sessions[0].title.startsWith('这是真正的第一条消息')).toBe(true);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('listSessionsInProject falls back to a placeholder title for a session with no real user text', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-empty', [
      { type: 'mode', mode: 'normal', sessionId: 'session-empty' },
      { type: 'file-history-snapshot', messageId: 'x' },
    ]);

    const sessions = listSessionsInProject(cwd, projectsDir);
    expect(sessions[0].title).toBe('(空会话)');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('loadHistoricalSession replays a simple text-only conversation into Session shape', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'say hi in 3 words' }, cwd, uuid: 'u1' },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'simple', signature: 'x' }] },
        uuid: 'a1',
      },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello to you!' }] }, uuid: 'a2' },
    ]);

    const session = loadHistoricalSession(cwd, 'session-1', projectsDir);
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]).toEqual({ role: 'user', content: 'say hi in 3 words' });

    const assistantMsg = session.messages[1];
    if (assistantMsg.role !== 'assistant') throw new Error('expected assistant message');
    expect(assistantMsg.turn.response).toBe('Hello to you!');
    expect(assistantMsg.turn.isProcessing).toBe(false);
    // real 'thinking' blocks must be dropped, not shown as steps — same rule as the live translator
    expect(assistantMsg.turn.steps.map((s) => s.type)).toEqual(['thinking']);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('loadHistoricalSession replays a tool-use turn including the persisted tool_result shape', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'run echo hello' }, cwd, uuid: 'u1' },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hello' } }],
        },
        uuid: 'a1',
      },
      {
        // Persisted tool_result lines carry a denormalized top-level `toolUseResult` field
        // alongside the nested content block — the adapter should ignore it and just use
        // the nested block, exactly like the live stdout shape.
        type: 'user',
        message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: 'hello', is_error: false }] },
        toolUseResult: { stdout: 'hello', stderr: '' },
        uuid: 'u2',
      },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Printed: hello' }] }, uuid: 'a2' },
    ]);

    const session = loadHistoricalSession(cwd, 'session-1', projectsDir);
    const assistantMsg = session.messages[1];
    if (assistantMsg.role !== 'assistant') throw new Error('expected assistant message');

    expect(assistantMsg.turn.response).toBe('Printed: hello');
    const toolStep = assistantMsg.turn.steps.find((s) => s.type === 'tool_use');
    expect(toolStep).toBeDefined();
    if (toolStep?.type === 'tool_use') {
      expect(toolStep.pending).toBe(false);
      expect(toolStep.details).toEqual(['hello']);
    }
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('listProjectDirs filters out a project marked removed in the overrides sidecar', () => {
  const projectsDir = makeTempProjectsDir();
  try {
    writeSessionFile(projectsDir, '-Users-test-proj-a', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'hi' }, cwd: '/Users/test/proj-a', uuid: 'u1' },
    ]);
    writeSessionFile(projectsDir, '-Users-test-proj-b', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'hi' }, cwd: '/Users/test/proj-b', uuid: 'u1' },
    ]);
    const overridesPath = path.join(projectsDir, 'project-overrides.json');
    fs.writeFileSync(overridesPath, JSON.stringify({ '/Users/test/proj-a': { removed: true } }));

    const projects = listProjectDirs(projectsDir, overridesPath);
    expect(projects).toHaveLength(1);
    expect(projects[0].cwd).toBe('/Users/test/proj-b');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('listProjectDirs applies a customName override to displayName', () => {
  const projectsDir = makeTempProjectsDir();
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'hi' }, cwd: '/Users/test/proj', uuid: 'u1' },
    ]);
    const overridesPath = path.join(projectsDir, 'project-overrides.json');
    fs.writeFileSync(overridesPath, JSON.stringify({ '/Users/test/proj': { customName: '我的项目' } }));

    const projects = listProjectDirs(projectsDir, overridesPath);
    expect(projects[0].displayName).toBe('我的项目');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('listProjectDirs sorts a pinned project before a more recently active unpinned one', () => {
  const projectsDir = makeTempProjectsDir();
  try {
    writeSessionFile(projectsDir, '-Users-test-older', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'hi' }, cwd: '/Users/test/older', uuid: 'u1' },
    ]);
    const olderFile = path.join(projectsDir, '-Users-test-older', 'session-1.jsonl');
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(olderFile, past, past);

    writeSessionFile(projectsDir, '-Users-test-newer', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'hi' }, cwd: '/Users/test/newer', uuid: 'u1' },
    ]);

    const overridesPath = path.join(projectsDir, 'project-overrides.json');
    fs.writeFileSync(overridesPath, JSON.stringify({ '/Users/test/older': { pinned: true } }));

    const projects = listProjectDirs(projectsDir, overridesPath);
    expect(projects.map((p) => p.cwd)).toEqual(['/Users/test/older', '/Users/test/newer']);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('listProjectDirs reports pinned: false for a project with no override entry', () => {
  const projectsDir = makeTempProjectsDir();
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'hi' }, cwd: '/Users/test/proj', uuid: 'u1' },
    ]);

    const projects = listProjectDirs(projectsDir, path.join(projectsDir, 'nonexistent-overrides.json'));
    expect(projects[0].pinned).toBe(false);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('listSessionsInProject filters out sessions marked removed or archived in the overrides sidecar', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-visible', [
      { type: 'user', message: { role: 'user', content: 'hi' }, cwd, uuid: 'u1' },
    ]);
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-removed', [
      { type: 'user', message: { role: 'user', content: 'hi' }, cwd, uuid: 'u2' },
    ]);
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-archived', [
      { type: 'user', message: { role: 'user', content: 'hi' }, cwd, uuid: 'u3' },
    ]);
    const overridesPath = path.join(projectsDir, 'session-overrides.json');
    fs.writeFileSync(
      overridesPath,
      JSON.stringify({ 'session-removed': { removed: true }, 'session-archived': { archived: true } })
    );

    const sessions = listSessionsInProject(cwd, projectsDir, overridesPath);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('session-visible');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('listSessionsInProject prefers CCodeBox’s local display-title override without editing Claude history', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: '原始 Claude 会话标题' }, cwd, uuid: 'u1' },
    ]);
    const overridesPath = path.join(projectsDir, 'session-overrides.json');
    fs.writeFileSync(overridesPath, JSON.stringify({ 'session-1': { title: '我的重命名会话' } }));

    const sessions = listSessionsInProject(cwd, projectsDir, overridesPath);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('我的重命名会话');

    const transcript = fs.readFileSync(path.join(projectsDir, '-Users-test-proj', 'session-1.jsonl'), 'utf8');
    expect(transcript).toContain('原始 Claude 会话标题');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('computeForkCutoffs returns one cutoff per turn, with lineCount pointing at the next turn boundary', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'first question' }, cwd, uuid: 'u1' },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] }, uuid: 'a1' },
      { type: 'user', message: { role: 'user', content: 'second question' }, cwd, uuid: 'u2' },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'second answer' }] }, uuid: 'a2' },
    ]);

    const cutoffs = computeForkCutoffs(cwd, 'session-1', projectsDir);
    expect(cutoffs).toEqual([
      { turnIndex: 0, lineCount: 2 },
      { turnIndex: 1, lineCount: 4 },
    ]);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('computeForkCutoffs returns an empty array for a nonexistent session file', () => {
  const projectsDir = makeTempProjectsDir();
  try {
    expect(computeForkCutoffs('/Users/test/proj', 'no-such-session', projectsDir)).toEqual([]);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('listSessionsInProject skips a local-command echo line when deriving the title, using the real next message instead', () => {
  // Real shape confirmed by hand: sending a slash command (e.g. `/context`) as plain message
  // text round-trips through the CLI's persistence as a genuine, non-tool-result, isMeta:false
  // 'user' line with content rewritten to this <command-name> XML wrapper — indistinguishable
  // from a real user turn by isMeta alone. If a session's first message ever happens to be one
  // of these (e.g. an ambient background query fired before the user typed anything), the title
  // must not become this unreadable XML blob.
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      {
        type: 'user',
        isMeta: true,
        message: { role: 'user', content: '<local-command-caveat>Caveat: the messages below...' },
        cwd,
        uuid: 'u0',
      },
      {
        type: 'user',
        message: { role: 'user', content: '<command-name>/context</command-name>\n<command-message>context</command-message>' },
        cwd,
        uuid: 'u1',
      },
      { type: 'system', isMeta: false, subtype: 'local_command', content: '<local-command-stdout>## Context Usage...' },
      { type: 'user', message: { role: 'user', content: '在吗' }, cwd, uuid: 'u2' },
    ]);

    const sessions = listSessionsInProject(cwd, projectsDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('在吗');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('loadHistoricalSession does not create a phantom empty turn for a local-command echo line', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'say hi in 3 words' }, cwd, uuid: 'u1' },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello to you!' }] }, uuid: 'a1' },
      {
        type: 'user',
        isMeta: true,
        message: { role: 'user', content: '<local-command-caveat>Caveat: the messages below...' },
        cwd,
        uuid: 'u2',
      },
      {
        type: 'user',
        message: { role: 'user', content: '<command-name>/context</command-name>\n<command-message>context</command-message>' },
        cwd,
        uuid: 'u3',
      },
      { type: 'system', isMeta: false, subtype: 'local_command', content: '<local-command-stdout>## Context Usage...' },
    ]);

    const session = loadHistoricalSession(cwd, 'session-1', projectsDir);
    // Exactly the one real turn — the trailing local-command echo must not appear as a second,
    // empty user+assistant pair.
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]).toEqual({ role: 'user', content: 'say hi in 3 words' });
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('computeForkCutoffs does not count a tool_result reply as a new turn boundary', () => {
  const projectsDir = makeTempProjectsDir();
  const cwd = '/Users/test/proj';
  try {
    writeSessionFile(projectsDir, '-Users-test-proj', 'session-1', [
      { type: 'user', message: { role: 'user', content: 'run echo hello' }, cwd, uuid: 'u1' },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }] },
        uuid: 'a1',
      },
      {
        type: 'user',
        message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: 'hello', is_error: false }] },
        uuid: 'u2',
      },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Printed: hello' }] }, uuid: 'a2' },
    ]);

    const cutoffs = computeForkCutoffs(cwd, 'session-1', projectsDir);
    expect(cutoffs).toEqual([{ turnIndex: 0, lineCount: 4 }]);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});
