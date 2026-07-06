import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeUsageStats, computeStreakDays, localDateKey, isoDateKey, computeLongestStreakDays } from '../src/main/system/usageStats';

function makeTempProjectsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-usage-test-'));
}

function writeSessionFile(projectsDir: string, encodedDir: string, sessionFile: string, lines: object[]): void {
  const dirPath = path.join(projectsDir, encodedDir);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, sessionFile), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

function atLocalTime(iso: string): Date {
  return new Date(iso);
}

test('computeUsageStats sums tokens per file and attributes them to the real cwd found anywhere in the file', () => {
  const projectsDir = makeTempProjectsDir();
  try {
    writeSessionFile(projectsDir, '-Users-test-proj-a', 'session-1.jsonl', [
      { type: 'user', message: { role: 'user', content: 'hi' }, timestamp: '2026-01-01T00:00:00.000Z' },
      // cwd shows up on a later line, not the first — must still be attributed correctly.
      { type: 'assistant', cwd: '/Users/test/proj-a', message: { usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 1, cache_read_input_tokens: 2 } }, timestamp: '2026-01-01T00:00:01.000Z' },
      { type: 'assistant', message: { usage: { input_tokens: 5, output_tokens: 5 } }, timestamp: '2026-01-01T00:00:02.000Z' },
    ]);
    writeSessionFile(projectsDir, '-Users-test-proj-b', 'session-1.jsonl', [
      { type: 'user', message: { role: 'user', content: 'hi' }, cwd: '/Users/test/proj-b', timestamp: '2026-01-02T00:00:00.000Z' },
      { type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 200 } }, timestamp: '2026-01-02T00:00:01.000Z' },
    ]);

    const stats = computeUsageStats(projectsDir);

    expect(stats.totalSessions).toBe(2);
    expect(stats.totalProjects).toBe(2);
    expect(stats.totalTokens).toBe(10 + 20 + 1 + 2 + 5 + 5 + 100 + 200);
    expect(stats.perProject).toEqual([
      { cwd: '/Users/test/proj-b', sessionCount: 1, totalTokens: 300 },
      { cwd: '/Users/test/proj-a', sessionCount: 1, totalTokens: 43 },
    ]);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('computeUsageStats tolerates unparseable lines and files with no cwd or usage at all', () => {
  const projectsDir = makeTempProjectsDir();
  try {
    writeSessionFile(projectsDir, '-Users-test-empty', 'session-1.jsonl', [
      { type: 'user', message: { role: 'user', content: 'hi' } },
    ]);
    fs.appendFileSync(path.join(projectsDir, '-Users-test-empty', 'session-1.jsonl'), 'not valid json\n');

    const stats = computeUsageStats(projectsDir);

    expect(stats.totalSessions).toBe(1);
    expect(stats.totalTokens).toBe(0);
    expect(stats.perProject).toEqual([]); // no cwd ever appeared in the file, so it can't be attributed
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('computeUsageStats returns honest zeroes for a missing projects directory', () => {
  const missingDir = path.join(os.tmpdir(), 'ccodebox-usage-test-missing-does-not-exist');
  const stats = computeUsageStats(missingDir);

  expect(stats.totalSessions).toBe(0);
  expect(stats.totalProjects).toBe(0);
  expect(stats.totalTokens).toBe(0);
  expect(stats.perProject).toEqual([]);
});

test('computeUsageStats always returns non-negative skill-usage counts (real ~/.claude.json on this machine)', () => {
  const stats = computeUsageStats(makeTempProjectsDir());
  expect(stats.skillsExploredCount).toBeGreaterThanOrEqual(0);
  expect(stats.totalSkillUsageCount).toBeGreaterThanOrEqual(0);
});

test('computeStreakDays counts backward from today when today already has activity', () => {
  const now = atLocalTime('2026-07-04T12:00:00');
  const days = new Set([
    localDateKey(atLocalTime('2026-07-04T08:00:00').toISOString()),
    localDateKey(atLocalTime('2026-07-03T08:00:00').toISOString()),
    localDateKey(atLocalTime('2026-07-02T08:00:00').toISOString()),
  ]);
  expect(computeStreakDays(days, now)).toBe(3);
});

test('computeStreakDays still counts through yesterday when today has no activity yet', () => {
  const now = atLocalTime('2026-07-04T00:30:00');
  const days = new Set([
    localDateKey(atLocalTime('2026-07-03T08:00:00').toISOString()),
    localDateKey(atLocalTime('2026-07-02T08:00:00').toISOString()),
  ]);
  expect(computeStreakDays(days, now)).toBe(2);
});

test('computeStreakDays stops counting at the first gap', () => {
  const now = atLocalTime('2026-07-04T12:00:00');
  const days = new Set([
    localDateKey(atLocalTime('2026-07-04T08:00:00').toISOString()),
    // gap on 07-03
    localDateKey(atLocalTime('2026-07-02T08:00:00').toISOString()),
  ]);
  expect(computeStreakDays(days, now)).toBe(1);
});

test('computeStreakDays returns 0 when neither today nor yesterday has activity', () => {
  const now = atLocalTime('2026-07-04T12:00:00');
  const days = new Set([localDateKey(atLocalTime('2026-07-01T08:00:00').toISOString())]);
  expect(computeStreakDays(days, now)).toBe(0);
});

test('computeStreakDays returns 0 for an empty set', () => {
  expect(computeStreakDays(new Set(), atLocalTime('2026-07-04T12:00:00'))).toBe(0);
});

test('isoDateKey zero-pads single-digit month and day, unlike localDateKey', () => {
  const iso = atLocalTime('2026-03-04T12:00:00').toISOString();
  expect(isoDateKey(iso)).toBe('2026-03-04');
  expect(localDateKey(iso)).toBe('2026-2-4');
});

test('computeLongestStreakDays finds the longest historical streak, not just one anchored to today', () => {
  const days = new Set([
    // A 2-day streak...
    localDateKey(atLocalTime('2026-01-01T08:00:00').toISOString()),
    localDateKey(atLocalTime('2026-01-02T08:00:00').toISOString()),
    // ...a gap...
    // ...then a longer 3-day streak, including a month boundary (Jan 31 -> Feb 1), to prove
    // days are compared as real Date objects and not sorted/diffed as non-padded strings.
    localDateKey(atLocalTime('2026-01-31T08:00:00').toISOString()),
    localDateKey(atLocalTime('2026-02-01T08:00:00').toISOString()),
    localDateKey(atLocalTime('2026-02-02T08:00:00').toISOString()),
  ]);
  expect(computeLongestStreakDays(days)).toBe(3);
});

test('computeLongestStreakDays returns 1 for a single active day and 0 for none', () => {
  const single = new Set([localDateKey(atLocalTime('2026-07-04T08:00:00').toISOString())]);
  expect(computeLongestStreakDays(single)).toBe(1);
  expect(computeLongestStreakDays(new Set())).toBe(0);
});
