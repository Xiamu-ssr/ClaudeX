#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
function getArgValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

// Attachments (Feature 2) make stdin `content` array-shaped ([{type:'text',...}, {type:'image',...}]);
// real user turns are plain strings otherwise. Extract the text block either way so the existing
// magic-string checks (__SIMULATE_CRASH__ etc.) and reply templating keep working unchanged.
function extractUserText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => b?.type === 'text');
    return textBlock?.text ?? '';
  }
  return '';
}

// Canned `claude plugin list --available --json` catalog. Mirrors the real local marketplace
// layout confirmed by hand: first-party skills under ./plugins/, first-party MCP-connector
// wrappers under ./external_plugins/, third-party entries with an object (not string) `source`.
const FIXTURE_CATALOG = [
  {
    pluginId: 'demo-connector@ccodebox-fixture',
    name: 'demo-connector',
    description: 'Demo MCP connector for testing',
    source: './external_plugins/demo-connector',
    installCount: 500,
  },
  {
    pluginId: 'demo-skill@ccodebox-fixture',
    name: 'demo-skill',
    description: 'Demo skill for testing',
    source: './plugins/demo-skill',
    installCount: 300,
  },
  {
    pluginId: 'third-party-demo@ccodebox-fixture',
    name: 'third-party-demo',
    description: 'Third-party demo plugin (not vendored locally)',
    source: { type: 'git', url: 'https://example.com/third-party-demo.git' },
    installCount: 100,
  },
  {
    pluginId: '__SIMULATE_FAILURE__-connector@ccodebox-fixture',
    name: '__SIMULATE_FAILURE__-connector',
    description: 'Triggers a simulated install failure (magic name for testing)',
    source: './external_plugins/simulate-failure-connector',
    installCount: 10,
  },
];

// Persisted across separate process invocations (each execFileSync call is a fresh process),
// scoped per-test via CCODEBOX_FAKE_PLUGIN_STATE so installs in one test can't leak into another.
const PLUGIN_STATE_PATH =
  process.env.CCODEBOX_FAKE_PLUGIN_STATE || path.join(os.tmpdir(), 'ccodebox-fake-plugin-state.json');

function readInstalledPluginIds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PLUGIN_STATE_PATH, 'utf8'));
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeInstalledPluginIds(ids) {
  fs.writeFileSync(PLUGIN_STATE_PATH, JSON.stringify([...ids]));
}

function handlePluginCommand(subArgs) {
  const action = subArgs[0];

  if (action === 'list' && subArgs.includes('--available')) {
    process.stdout.write(JSON.stringify({ available: FIXTURE_CATALOG }) + '\n');
    process.exit(0);
  }

  if (action === 'list') {
    const entries = [...readInstalledPluginIds()].map((id) => ({ id, version: '1.0.0', scope: 'user' }));
    process.stdout.write(JSON.stringify(entries) + '\n');
    process.exit(0);
  }

  // Both branches below add an artificial delay, same technique used for `doctor` and chat
  // replies, to make the transient "安装中.../卸载中..." UI state reliably observable in tests
  // instead of racing a near-instant synchronous execFileSync round trip. Needs to be much
  // longer than those (500ms measured insufficient by hand) — confirmed by hand via a raw
  // Playwright diagnostic that a single .click() on this view alone can take 600-650ms to
  // resolve (actionability/stability checks, not locator choice: reproduced identically with
  // both getByRole and plain getByText), so the window has to clear that with real margin.
  if (action === 'install' || action === 'i') {
    const pluginId = subArgs[1];
    setTimeout(() => {
      if (typeof pluginId === 'string' && pluginId.includes('__SIMULATE_FAILURE__')) {
        process.stderr.write(`fake-claude: simulated install failure for ${pluginId}\n`);
        process.exit(1);
      }
      const installed = readInstalledPluginIds();
      installed.add(pluginId);
      writeInstalledPluginIds(installed);
      process.stdout.write(`Installed ${pluginId}\n`);
      process.exit(0);
    }, 2000);
    return;
  }

  if (action === 'uninstall' || action === 'remove') {
    const pluginName = subArgs[1];
    setTimeout(() => {
      const installed = readInstalledPluginIds();
      for (const id of [...installed]) {
        if (id === pluginName || id.split('@')[0] === pluginName) installed.delete(id);
      }
      writeInstalledPluginIds(installed);
      process.stdout.write(`Uninstalled ${pluginName}\n`);
      process.exit(0);
    }, 2000);
    return;
  }

  process.stderr.write(`fake-claude: unrecognized plugin subcommand: ${subArgs.join(' ')}\n`);
  process.exit(1);
}

if (args[0] === '--version') {
  process.stdout.write('2.1.201 (Claude Code)\n');
  process.exit(0);
} else if (args[0] === 'doctor') {
  // Small artificial delay so tests can assert on the transient "运行中..." UI state,
  // mirroring the same technique used for chat replies below.
  setTimeout(() => {
    process.stdout.write('✔ Claude Code CLI 安装正常\n✔ 配置文件可读\n✔ 未发现问题\n');
    process.exit(0);
  }, 200);
} else if (args[0] === 'plugin') {
  handlePluginCommand(args.slice(1));
} else if (args[0] === 'auth' && args[1] === 'status') {
  // Mirrors the real shape confirmed by hand: {loggedIn, authMethod, apiProvider}.
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'oauth_token', apiProvider: 'firstParty' }) + '\n');
  process.exit(0);
} else {
  const sessionId = getArgValue('--session-id') || getArgValue('--resume') || 'fake-session-id';

  function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }

  emit({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    cwd: process.cwd(),
    tools: [],
    model: 'fake-model',
    slash_commands: ['clear', 'compact', 'context', 'demo-skill', 'review'],
  });

  const rl = readline.createInterface({ input: process.stdin });

  let pending = 0;
  let stdinClosed = false;

  function maybeExit() {
    if (stdinClosed && pending === 0) process.exit(0);
  }

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const userText = extractUserText(parsed?.message?.content);

    // Simulates a genuine unexpected process crash mid-turn: the process dies without ever
    // emitting a `result` line, mirroring a real crash rather than a clean protocol error.
    if (userText.includes('__SIMULATE_CRASH__')) {
      pending++;
      setTimeout(() => {
        process.stderr.write('fake-claude: simulated unexpected crash\n');
        process.exit(17);
      }, 200);
      return;
    }

    // Artificial delay so tests can meaningfully assert on the intermediate
    // "processing" UI state, not just instant completion.
    pending++;
    setTimeout(() => {
      if (userText === '/context') {
        const contextReport = [
          '## Context Usage',
          '',
          '**Model:** fake-model',
          '**Tokens:** 12.0k / 200k (6%)',
          '',
          '### Estimated usage by category',
          '',
          '| Category | Tokens | Percentage |',
          '|----------|--------|------------|',
          '| System prompt | 2.0k | 1.0% |',
          '| Messages | 10.0k | 5.0% |',
          '| Free space | 188.0k | 94.0% |',
        ].join('\n');
        emit({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: contextReport }] },
          session_id: sessionId,
        });
        emit({
          type: 'result',
          subtype: 'success',
          result: contextReport,
          duration_ms: 50,
          session_id: sessionId,
        });
      } else if (userText.includes('__SIMULATE_ERROR__')) {
        // A well-formed but failed turn: the real CLI still emits a complete `result` line
        // with is_error:true (e.g. an incompatible model/effort combination), it isn't a hang.
        emit({
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          result: 'API Error: 400 simulated error for testing.',
          duration_ms: 300,
          session_id: sessionId,
        });
      } else {
        emit({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: `fake-reply: ${userText}` }] },
          session_id: sessionId,
        });
        emit({
          type: 'result',
          subtype: 'success',
          result: `fake-reply: ${userText}`,
          duration_ms: 300,
          session_id: sessionId,
        });
      }
      pending--;
      maybeExit();
    }, 400);
  });

  rl.on('close', () => {
    stdinClosed = true;
    maybeExit();
  });
}
