import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveClaudeBinary } from '../claude/ClaudeSession';
import type { CatalogPlugin, ConnectorPlugin, CustomMcpServer, McpServerSummary, PluginCatalog, ThirdPartyPlugin } from '../../shared/ipc';

const execFileAsync = promisify(execFile);
const PLUGIN_CMD_TIMEOUT_MS = 30_000;

interface RawAvailablePlugin {
  pluginId: string;
  name: string;
  description: string;
  source: string | Record<string, unknown>;
  installCount: number;
}

// execFileAsync (promisified, non-blocking), not execFileSync: this runs inside an
// ipcMain.handle callback, and execFileSync blocks Electron's entire main-process thread —
// including its own CDP/renderer dispatch — for the whole subprocess duration. Confirmed by
// hand: with execFileSync here, a slow install/uninstall froze the whole app, not just this
// call. Same async pattern already used by system/version.ts for --version/doctor.
//
// resolveClaudeBinary() (login-shell resolution), not bare 'claude': PATH order is not
// reliable here — confirmed by hand that a plain `nvm use 22` shell resolves bare `claude`
// to a broken Homebrew install on this very machine (same PATH-sensitivity ClaudeSession.ts
// already had to work around), and a Finder-launched packaged app's PATH is even sparser.
// Tests inject a fake binary via CCODEBOX_CLAUDE_BIN (see tests/fixtures/fake-claude).
async function readAvailablePlugins(): Promise<RawAvailablePlugin[]> {
  try {
    const bin = resolveClaudeBinary();
    const { stdout } = await execFileAsync(bin, ['plugin', 'list', '--available', '--json'], {
      timeout: PLUGIN_CMD_TIMEOUT_MS,
    });
    const parsed = JSON.parse(stdout) as { available?: RawAvailablePlugin[] };
    return parsed.available ?? [];
  } catch {
    return []; // claude CLI not resolvable, or marketplace not configured
  }
}

// Real shape confirmed by hand (installed in an isolated scratch project at --scope project,
// then uninstalled again): `claude plugin list --json` -> `[{ id: "<name>@<marketplace>",
// scope, installPath, ... }]`. No separate `name` field — split `id` on `@` for the name.
async function readInstalledPluginNames(): Promise<Set<string>> {
  try {
    const bin = resolveClaudeBinary();
    const { stdout } = await execFileAsync(bin, ['plugin', 'list', '--json'], {
      timeout: PLUGIN_CMD_TIMEOUT_MS,
    });
    const parsed = JSON.parse(stdout) as Array<{ id?: string }>;
    const names = new Set<string>();
    for (const entry of Array.isArray(parsed) ? parsed : []) {
      if (typeof entry.id === 'string') names.add(entry.id.split('@')[0]);
    }
    return names;
  } catch {
    return new Set();
  }
}

function commandErrorMessage(err: unknown): string {
  const stderr = (err as { stderr?: unknown })?.stderr;
  if (typeof stderr === 'string' && stderr.trim()) return stderr.trim();
  if (Buffer.isBuffer(stderr) && stderr.length) return stderr.toString('utf8').trim();
  return err instanceof Error ? err.message : String(err);
}

// Installs/uninstalls at the default "user" scope (same default the bare CLI command
// itself uses) — this view has no notion of a "current project", it's presented as
// global marketplace browsing, so global scope is the consistent choice.
export async function installPlugin(pluginId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const bin = resolveClaudeBinary();
    const { stdout } = await execFileAsync(bin, ['plugin', 'install', pluginId], {
      timeout: PLUGIN_CMD_TIMEOUT_MS,
    });
    return { ok: true, message: stdout.trim() };
  } catch (err) {
    return { ok: false, message: commandErrorMessage(err) };
  }
}

export async function uninstallPlugin(pluginName: string): Promise<{ ok: boolean; message: string }> {
  try {
    const bin = resolveClaudeBinary();
    const { stdout } = await execFileAsync(bin, ['plugin', 'uninstall', pluginName, '-y'], {
      timeout: PLUGIN_CMD_TIMEOUT_MS,
    });
    return { ok: true, message: stdout.trim() };
  } catch (err) {
    return { ok: false, message: commandErrorMessage(err) };
  }
}

// Deliberately returns only `name`/`type` — never the raw server config, since
// remote MCP servers (e.g. Tavily) embed API keys/tokens directly in their `url`,
// and stdio servers can carry secrets in `env`. Those must never cross into the
// renderer (this repo gets pushed to a public GitHub, so nothing secret-shaped
// should even transiently exist in renderer state, screenshots, or logs).
export function listConfiguredMcpServers(): McpServerSummary[] {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8');
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, { type?: string; command?: string }> };
    return Object.entries(parsed.mcpServers ?? {}).map(([name, cfg]) => ({
      name,
      type: cfg?.type ?? (cfg?.command ? 'stdio' : 'unknown'),
    }));
  } catch {
    return [];
  }
}

function readConfiguredMcpServerNames(): Set<string> {
  return new Set(listConfiguredMcpServers().map((s) => s.name));
}

function readPersonalSkillNames(): string[] {
  const skillsDir = path.join(os.homedir(), '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

interface InstalledPluginDetail {
  name: string;
  marketplace: string;
  description: string;
  installCount: number;
  hasMcpServers: boolean;
}

// `claude plugin list --available --json` (used above for the marketplace catalog) excludes
// already-installed plugins entirely — confirmed by hand, not an assumption — so anything
// installed disappears from the three arrays above unless recovered here. `claude plugin
// list --json` (already used by readInstalledPluginNames) gives the authoritative installed
// set, but only a minimal shape (id/version/scope/installPath/...) — no description, no
// category. Recover both from real local sources: the plugin's own manifest file (written to
// disk at install time, confirmed present at `<installPath>/.claude-plugin/plugin.json` with
// real `description`), and `claude plugin details <name>` for whether it provides any MCP
// servers (its own text-only "Component inventory" section prints e.g. "MCP servers (2)" —
// confirmed by hand; there is no --json variant for this subcommand, so this parses that
// text output defensively and defaults to `hasMcpServers: false` if parsing fails for any
// reason, which is the safer default (worst case an MCP-backed plugin lands in Skills/
// third-party instead of Connectors, not a crash).
async function readInstalledPluginDetails(): Promise<InstalledPluginDetail[]> {
  try {
    const bin = resolveClaudeBinary();
    const { stdout } = await execFileAsync(bin, ['plugin', 'list', '--json'], {
      timeout: PLUGIN_CMD_TIMEOUT_MS,
    });
    const parsed = JSON.parse(stdout) as Array<{ id?: string; installPath?: string }>;
    const entries = Array.isArray(parsed) ? parsed : [];

    return await Promise.all(
      entries
        .filter((e): e is { id: string; installPath?: string } => typeof e.id === 'string')
        .map(async (entry) => {
          const [name, marketplace] = entry.id.split('@');
          let description = '';
          if (entry.installPath) {
            try {
              const manifestRaw = fs.readFileSync(
                path.join(entry.installPath, '.claude-plugin', 'plugin.json'),
                'utf8',
              );
              const manifest = JSON.parse(manifestRaw) as { description?: string };
              description = manifest.description ?? '';
            } catch {
              // manifest missing or unreadable — leave description empty rather than guessing
            }
          }

          let hasMcpServers = false;
          try {
            const { stdout: detailsOut } = await execFileAsync(bin, ['plugin', 'details', name], {
              timeout: PLUGIN_CMD_TIMEOUT_MS,
            });
            const match = detailsOut.match(/MCP servers\s*\((\d+)\)/);
            hasMcpServers = match ? Number(match[1]) > 0 : false;
          } catch {
            // details command failed — default false (see comment above on why that's the safe default)
          }

          return {
            name,
            marketplace: marketplace ?? '未知来源',
            description,
            installCount: 0,
            hasMcpServers,
          };
        }),
    );
  } catch {
    return [];
  }
}

export async function loadPluginCatalog(): Promise<PluginCatalog> {
  const [available, installedNames] = await Promise.all([readAvailablePlugins(), readInstalledPluginNames()]);
  const configuredNames = readConfiguredMcpServerNames();

  const officialSkills: CatalogPlugin[] = [];
  const connectors: ConnectorPlugin[] = [];
  const thirdPartyPlugins: ThirdPartyPlugin[] = [];

  for (const plugin of available) {
    // `installed` for ALL THREE buckets means "installed via `claude plugin install`", checked
    // against the real plugin registry (readInstalledPluginNames) — confirmed by hand that
    // installing a connector plugin never touches ~/.claude.json's mcpServers at all (it
    // writes to ~/.claude/plugins/installed_plugins.json + an enabledPlugins map in the
    // scope's settings file instead). mcpServers is a separate, unrelated concept: servers
    // wired directly via `claude mcp add` (see customMcpServers below), not through a plugin.
    const entry: CatalogPlugin = {
      id: plugin.pluginId,
      name: plugin.name,
      description: plugin.description,
      installCount: plugin.installCount,
      installed: installedNames.has(plugin.name),
    };
    // Local marketplace layout: first-party skills live under ./plugins/, and first-party
    // MCP-server connector wrappers live under ./external_plugins/. Everything else — a
    // string source that doesn't match either prefix (e.g. "./" for a marketplace whose
    // repo root IS the plugin), or an object source (a separate git repo entirely) — is a
    // real third-party/marketplace plugin, not something to silently discard.
    if (typeof plugin.source === 'string' && plugin.source.startsWith('./plugins/')) {
      officialSkills.push(entry);
    } else if (typeof plugin.source === 'string' && plugin.source.startsWith('./external_plugins/')) {
      connectors.push({ ...entry, configuredOutsidePlugin: configuredNames.has(entry.name) && !entry.installed });
    } else {
      const marketplace = plugin.pluginId.includes('@') ? plugin.pluginId.split('@')[1] : '未知来源';
      thirdPartyPlugins.push({ ...entry, marketplace });
    }
  }

  officialSkills.sort((a, b) => b.installCount - a.installCount);
  connectors.sort((a, b) => b.installCount - a.installCount);
  thirdPartyPlugins.sort((a, b) => b.installCount - a.installCount);

  // `claude plugin list --available --json` (used above) omits already-installed plugins
  // entirely — confirmed by hand, not an assumption — so anything the user has installed
  // via `claude plugin install` vanishes from all three arrays above. Recover those entries
  // here from `claude plugin list --json` + each plugin's on-disk manifest + `claude plugin
  // details`, all real local sources (no invented data). See readInstalledPluginDetails above.
  const installedDetails = await readInstalledPluginDetails();
  const namesAlreadyShown = new Set(
    [...officialSkills, ...connectors, ...thirdPartyPlugins].map((p) => p.name),
  );
  for (const detail of installedDetails) {
    if (namesAlreadyShown.has(detail.name)) continue; // still in `available` (not yet installed at time of that fetch's own listing, or timing), don't duplicate
    const entry: CatalogPlugin = {
      id: `${detail.name}@${detail.marketplace}`,
      name: detail.name,
      description: detail.description,
      installCount: detail.installCount,
      installed: true,
    };
    if (detail.hasMcpServers) {
      connectors.push({ ...entry, configuredOutsidePlugin: false });
    } else if (detail.marketplace === 'claude-plugins-official') {
      officialSkills.push(entry);
    } else {
      thirdPartyPlugins.push({ ...entry, marketplace: detail.marketplace });
    }
  }

  // Servers configured directly (e.g. via `claude mcp add`), not through the plugin/marketplace
  // system at all — e.g. a hosted MCP endpoint like Tavily. Independent of `installed` above.
  const connectorNames = new Set(connectors.map((c) => c.name));
  const customMcpServers: CustomMcpServer[] = [...configuredNames]
    .filter((name) => !connectorNames.has(name))
    .map((name) => ({ name }));

  // Personal skills live directly under ~/.claude/skills — being listed here at all means
  // they exist on disk, so `installed` is trivially true (there's no "not installed" state
  // to represent, unlike marketplace entries).
  const personalSkills: CatalogPlugin[] = readPersonalSkillNames().map((name) => ({
    id: name,
    name,
    description: '',
    installCount: 0,
    installed: true,
  }));

  return { connectors, customMcpServers, officialSkills, personalSkills, thirdPartyPlugins };
}

// claude mcp add <name> -- <command> [...args]: the "--" separator (confirmed against
// `claude mcp add --help`) marks everything after it as the subprocess command/args being
// registered, not flags for `claude mcp add` itself. Explicit "-s user" scope matches
// installPlugin's user-scope default above, for the same reason (this view has no notion
// of a "current project").
export async function addMcpServer(name: string, command: string, args: string[]): Promise<{ ok: boolean; message: string }> {
  try {
    const bin = resolveClaudeBinary();
    const { stdout } = await execFileAsync(bin, ['mcp', 'add', name, '-s', 'user', '--', command, ...args], {
      timeout: PLUGIN_CMD_TIMEOUT_MS,
    });
    return { ok: true, message: stdout.trim() };
  } catch (err) {
    return { ok: false, message: commandErrorMessage(err) };
  }
}
