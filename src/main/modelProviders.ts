import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { ModelProviderConfig } from '../shared/ipc';

const BUILTIN_ANTHROPIC_PROVIDER: ModelProviderConfig = {
  id: 'builtin-anthropic',
  name: 'Anthropic',
  builtin: true,
  env: {},
  models: [
    { id: 'claude-opus-4-8', label: 'Opus 4.8' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
    { id: 'claude-fable-5', label: 'Fable 5' },
  ],
};

function configPath(): string {
  return path.join(app.getPath('userData'), 'model-providers.json');
}

function readCustomProviders(): ModelProviderConfig[] {
  const file = configPath();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((p): p is ModelProviderConfig => !p.builtin) : [];
  } catch {
    return [];
  }
}

function writeCustomProviders(providers: ModelProviderConfig[]): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(providers, null, 2));
}

export function listModelProviders(): ModelProviderConfig[] {
  return [BUILTIN_ANTHROPIC_PROVIDER, ...readCustomProviders()];
}

export function saveModelProvider(provider: ModelProviderConfig): ModelProviderConfig[] {
  if (provider.builtin) return listModelProviders(); // the built-in provider is not user-editable
  const providers = readCustomProviders();
  const idx = providers.findIndex((p) => p.id === provider.id);
  if (idx >= 0) providers[idx] = provider;
  else providers.push(provider);
  writeCustomProviders(providers);
  return listModelProviders();
}

export function deleteModelProvider(id: string): ModelProviderConfig[] {
  writeCustomProviders(readCustomProviders().filter((p) => p.id !== id));
  return listModelProviders();
}
