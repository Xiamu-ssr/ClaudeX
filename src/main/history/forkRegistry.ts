import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';

export interface ForkRecord {
  forkedFromSessionId: string;
  forkedAtTurnIndex: number;
  cwd: string;
  createdAt: string;
}
export type ForkRegistry = Record<string, ForkRecord>;

function defaultConfigPath(): string {
  try {
    return path.join(app.getPath('userData'), 'fork-registry.json');
  } catch {
    // `app` is unavailable outside the Electron runtime (e.g. unit tests imported
    // via Playwright). Fall back to a tmp path that won't hold a real registry
    // file, so readForkRegistry() returns {} as if no forks exist.
    return path.join(os.tmpdir(), 'fork-registry.json');
  }
}

export function readForkRegistry(configPath: string = defaultConfigPath()): ForkRegistry {
  if (!fs.existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeForkRegistry(registry: ForkRegistry, configPath: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(registry, null, 2));
}

export function registerFork(
  newSessionId: string,
  record: ForkRecord,
  configPath: string = defaultConfigPath()
): void {
  const registry = readForkRegistry(configPath);
  registry[newSessionId] = record;
  writeForkRegistry(registry, configPath);
}
