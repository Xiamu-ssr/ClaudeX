import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { HooksConfig, HookMatcherEntry, PermissionsConfig, EnvVarSummary } from '../../shared/ipc';

interface RawHookEntry {
  matcher?: string;
  hooks?: Array<{ command?: string }>;
}
interface RawSettings {
  hooks?: Record<string, RawHookEntry[]>;
  permissions?: { allow?: string[]; ask?: string[]; deny?: string[]; defaultMode?: string };
  env?: Record<string, string>;
}

function readJsonFile(filePath: string): RawSettings {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {}; // missing file, or present-but-invalid — either way, nothing to contribute
  }
}

// Precedence follows Claude Code's own scope order (user < project < project-local), read
// low-to-high so the merge loop below can just append in order.
function settingsFilesForCwd(cwd: string): string[] {
  return [
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.local.json'),
  ];
}

function mergeHooks(files: RawSettings[]): HooksConfig {
  const merged: HooksConfig = {};
  for (const file of files) {
    for (const [event, entries] of Object.entries(file.hooks ?? {})) {
      const mapped: HookMatcherEntry[] = entries.map((e) => ({
        matcher: e.matcher,
        commands: (e.hooks ?? []).map((h) => h.command ?? '').filter(Boolean),
      }));
      merged[event] = [...(merged[event] ?? []), ...mapped];
    }
  }
  return merged;
}

function mergePermissions(files: RawSettings[]): PermissionsConfig {
  const allow = new Set<string>();
  const ask = new Set<string>();
  const deny = new Set<string>();
  let defaultMode: string | undefined;
  for (const file of files) {
    for (const v of file.permissions?.allow ?? []) allow.add(v);
    for (const v of file.permissions?.ask ?? []) ask.add(v);
    for (const v of file.permissions?.deny ?? []) deny.add(v);
    if (file.permissions?.defaultMode) defaultMode = file.permissions.defaultMode; // most-specific wins
  }
  return { allow: [...allow], ask: [...ask], deny: [...deny], defaultMode };
}

export function readProjectSettings(cwd: string): { hooks: HooksConfig; permissions: PermissionsConfig } {
  const files = settingsFilesForCwd(cwd).map(readJsonFile);
  return { hooks: mergeHooks(files), permissions: mergePermissions(files) };
}

function maskValue(value: string): string {
  return `${'•'.repeat(Math.min(value.length, 8))} (${value.length} 字符)`;
}

// Only the global ~/.claude/settings.json `env` key — Claude Code's own env config that
// affects every real `claude` invocation, distinct from CCodeBox's own per-provider env
// overrides (which live in ModelSettingsModal and are edited directly by the user, not read
// from disk). Values are masked before ever leaving the main process — this repo goes to a
// public GitHub, and these are exactly the kind of fields that must never appear in a
// renderer snapshot, test artifact, or screenshot.
export function readGlobalEnvConfig(): EnvVarSummary[] {
  const settings = readJsonFile(path.join(os.homedir(), '.claude', 'settings.json'));
  return Object.entries(settings.env ?? {}).map(([key, value]) => ({
    key,
    maskedValue: maskValue(String(value)),
  }));
}

export function claudeMdPath(cwd: string): string {
  return path.join(cwd, 'CLAUDE.md');
}
