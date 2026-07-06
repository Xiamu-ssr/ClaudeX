import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';

export interface ProjectOverride {
  pinned?: boolean;
  customName?: string;
  removed?: boolean;
  collapsed?: boolean;
}
export type ProjectOverrides = Record<string, ProjectOverride>;

function defaultConfigPath(): string {
  try {
    return path.join(app.getPath('userData'), 'project-overrides.json');
  } catch {
    // `app` is unavailable outside the Electron runtime (e.g. unit tests imported
    // via Playwright). Fall back to a tmp path that won't hold a real overrides
    // file, so readProjectOverrides() returns {} as if no overrides exist.
    return path.join(os.tmpdir(), 'project-overrides.json');
  }
}

export function readProjectOverrides(configPath: string = defaultConfigPath()): ProjectOverrides {
  if (!fs.existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeProjectOverrides(overrides: ProjectOverrides, configPath: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(overrides, null, 2));
}

export function setProjectPinned(cwd: string, pinned: boolean, configPath: string = defaultConfigPath()): void {
  const overrides = readProjectOverrides(configPath);
  overrides[cwd] = { ...overrides[cwd], pinned };
  writeProjectOverrides(overrides, configPath);
}

export function renameProject(cwd: string, customName: string, configPath: string = defaultConfigPath()): void {
  const overrides = readProjectOverrides(configPath);
  overrides[cwd] = { ...overrides[cwd], customName };
  writeProjectOverrides(overrides, configPath);
}

export function removeProject(cwd: string, configPath: string = defaultConfigPath()): void {
  const overrides = readProjectOverrides(configPath);
  overrides[cwd] = { ...overrides[cwd], removed: true };
  writeProjectOverrides(overrides, configPath);
}

export function setProjectCollapsed(cwd: string, collapsed: boolean, configPath: string = defaultConfigPath()): void {
  const overrides = readProjectOverrides(configPath);
  overrides[cwd] = { ...overrides[cwd], collapsed };
  writeProjectOverrides(overrides, configPath);
}
