import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';

export interface SessionOverride {
  archived?: boolean;
  removed?: boolean;
}
export type SessionOverrides = Record<string, SessionOverride>;

function defaultConfigPath(): string {
  try {
    return path.join(app.getPath('userData'), 'session-overrides.json');
  } catch {
    // `app` is unavailable outside the Electron runtime (e.g. unit tests imported
    // via Playwright). Fall back to a tmp path that won't hold a real overrides
    // file, so readSessionOverrides() returns {} as if no overrides exist.
    return path.join(os.tmpdir(), 'session-overrides.json');
  }
}

export function readSessionOverrides(configPath: string = defaultConfigPath()): SessionOverrides {
  if (!fs.existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSessionOverrides(overrides: SessionOverrides, configPath: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(overrides, null, 2));
}

export function setSessionArchived(sessionId: string, configPath: string = defaultConfigPath()): void {
  const overrides = readSessionOverrides(configPath);
  overrides[sessionId] = { ...overrides[sessionId], archived: true };
  writeSessionOverrides(overrides, configPath);
}

export function removeSession(sessionId: string, configPath: string = defaultConfigPath()): void {
  const overrides = readSessionOverrides(configPath);
  overrides[sessionId] = { ...overrides[sessionId], removed: true };
  writeSessionOverrides(overrides, configPath);
}
