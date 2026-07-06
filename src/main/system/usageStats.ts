import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { UsageStats, SkillUsageEntry } from '../../shared/ipc';

const DEFAULT_CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const DAY_MS = 24 * 60 * 60 * 1000;

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function localDateKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Zero-padded YYYY-MM-DD, unlike localDateKey — needed wherever keys are sorted or
// displayed (the heatmap) rather than only used for Set membership.
export function isoDateKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${date}`;
}

export function computeStreakDays(activeDateKeys: Set<string>, now: Date): number {
  if (activeDateKeys.size === 0) return 0;

  const todayKey = localDateKey(now.toISOString());
  const yesterday = new Date(now.getTime() - DAY_MS);
  const yesterdayKey = localDateKey(yesterday.toISOString());

  // A streak "counts" through today even if today has no activity yet, as long as
  // yesterday does — otherwise finishing this stat right after midnight would look broken.
  let cursor = activeDateKeys.has(todayKey) ? now : activeDateKeys.has(yesterdayKey) ? yesterday : null;
  if (!cursor) return 0;

  let streak = 0;
  while (activeDateKeys.has(localDateKey(cursor.toISOString()))) {
    streak++;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return streak;
}

// localDateKey's keys are not zero-padded, so they must not be sorted as strings
// (e.g. "2026-10-2" would sort before "2026-9-1") — parse each back into a real Date
// via the unambiguous 3-arg constructor and sort/diff those instead.
function parseLocalDateKey(key: string): Date {
  const [year, month, date] = key.split('-').map(Number);
  return new Date(year, month, date);
}

// Longest historical streak ever, not anchored to today (unlike computeStreakDays).
export function computeLongestStreakDays(activeDateKeys: Set<string>): number {
  if (activeDateKeys.size === 0) return 0;
  const sortedDates = [...activeDateKeys].map(parseLocalDateKey).sort((a, b) => a.getTime() - b.getTime());

  let longest = 1;
  let current = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const dayDiff = Math.round((sortedDates[i].getTime() - sortedDates[i - 1].getTime()) / DAY_MS);
    if (dayDiff === 1) {
      current++;
      longest = Math.max(longest, current);
    } else if (dayDiff > 1) {
      current = 1;
    }
  }
  return longest;
}

function listAllSessionFiles(projectsDir: string): string[] {
  if (!fs.existsSync(projectsDir)) return [];
  const files: string[] = [];
  for (const dirName of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!dirName.isDirectory()) continue;
    const dirPath = path.join(projectsDir, dirName.name);
    for (const f of fs.readdirSync(dirPath)) {
      if (f.endsWith('.jsonl')) files.push(path.join(dirPath, f));
    }
  }
  return files;
}

function readSkillUsage(): { skillsExploredCount: number; totalSkillUsageCount: number; topSkills: SkillUsageEntry[] } {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    const skillUsage = (raw.skillUsage ?? {}) as Record<string, { usageCount?: number; lastUsedAt?: number }>;
    const entries = Object.entries(skillUsage);
    const topSkills = entries
      .map(([name, s]) => ({ name, usageCount: s.usageCount ?? 0, lastUsedAt: s.lastUsedAt ?? null }))
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 5);
    return {
      skillsExploredCount: entries.length,
      totalSkillUsageCount: entries.reduce((sum, [, s]) => sum + (s.usageCount ?? 0), 0),
      topSkills,
    };
  } catch {
    return { skillsExploredCount: 0, totalSkillUsageCount: 0, topSkills: [] };
  }
}

// Scans every local session transcript once — real, on-disk usage data, not a hosted
// billing/quota query (Claude Code CLI has no local command for that; see DESIGN.md).
export function computeUsageStats(projectsDir: string = DEFAULT_CLAUDE_PROJECTS_DIR): UsageStats {
  const files = listAllSessionFiles(projectsDir);
  const activeDateKeys = new Set<string>();
  const dailyTokensMap = new Map<string, number>();
  const perProjectMap = new Map<string, { sessionCount: number; totalTokens: number }>();
  let totalTokens = 0;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    // A file's `cwd` field can appear on any line depending on how far into the session
    // the peek lands, so tokens are tallied per-file first and only attributed to a
    // project once the file's cwd is known — never assumed from line order.
    let fileCwd: string | null = null;
    let fileTokens = 0;

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let parsed: { type?: string; timestamp?: string; cwd?: string; message?: { usage?: RawUsage } };
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.timestamp) activeDateKeys.add(localDateKey(parsed.timestamp));
      if (!fileCwd && typeof parsed.cwd === 'string') fileCwd = parsed.cwd;
      const usage = parsed.message?.usage;
      if (parsed.type === 'assistant' && usage) {
        const lineTokens =
          (usage.input_tokens ?? 0) +
          (usage.output_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0);
        totalTokens += lineTokens;
        fileTokens += lineTokens;
        if (parsed.timestamp) {
          const dayKey = isoDateKey(parsed.timestamp);
          dailyTokensMap.set(dayKey, (dailyTokensMap.get(dayKey) ?? 0) + lineTokens);
        }
      }
    }

    if (fileCwd) {
      const entry = perProjectMap.get(fileCwd) ?? { sessionCount: 0, totalTokens: 0 };
      entry.sessionCount += 1;
      entry.totalTokens += fileTokens;
      perProjectMap.set(fileCwd, entry);
    }
  }

  const totalProjects = fs.existsSync(projectsDir)
    ? fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length
    : 0;

  const { skillsExploredCount, totalSkillUsageCount, topSkills } = readSkillUsage();

  const perProject = [...perProjectMap.entries()]
    .map(([cwd, v]) => ({ cwd, sessionCount: v.sessionCount, totalTokens: v.totalTokens }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const dailyUsage = [...dailyTokensMap.entries()]
    .map(([date, tokens]) => ({ date, tokens }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const peakDayTokens = dailyUsage.reduce((max, d) => Math.max(max, d.tokens), 0);

  return {
    totalSessions: files.length,
    totalProjects,
    totalTokens,
    currentStreakDays: computeStreakDays(activeDateKeys, new Date()),
    longestStreakDays: computeLongestStreakDays(activeDateKeys),
    skillsExploredCount,
    totalSkillUsageCount,
    topSkills,
    perProject,
    dailyUsage,
    peakDayTokens,
  };
}
