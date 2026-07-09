import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FAKE_CLAUDE_BIN = path.join(__dirname, 'fixtures/fake-claude/fake-claude.mjs');

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let pluginStatePath: string;

test.beforeEach(async () => {
  // A fresh --user-data-dir per test keeps model-providers.json (and anything else
  // main writes to app.getPath('userData')) fully isolated from this machine's real
  // CCodeBox profile — same isolation pattern as tests/app.spec.ts.
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-userdata-'));
  // Same isolation for the fake CLI's simulated plugin-install state: each execFileAsync
  // call from pluginCatalog.ts is a fresh process with no shared memory, so fake-claude.mjs
  // persists "installed" plugin ids to this file instead — must be per-test like userDataDir.
  pluginStatePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-pluginstate-')),
    'state.json',
  );
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, CCODEBOX_CLAUDE_BIN: FAKE_CLAUDE_BIN, CCODEBOX_FAKE_PLUGIN_STATE: pluginStatePath },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  // app.close() can hang indefinitely after a ClaudeSession child process was spawned and
  // stopped during the test (same race as tests/app.spec.ts). Race against a short timeout
  // and force-kill as a fallback so a flaky close doesn't burn the whole test run.
  await Promise.race([
    app.close(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  try {
    app.process().kill('SIGKILL');
  } catch {
    // already exited — expected in the common case.
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(path.dirname(pluginStatePath), { recursive: true, force: true });
});

// Regression test for a real, confirmed-by-hand bug: `claude plugin list --available --json`
// excludes already-installed plugins entirely (it doesn't mark them installed:true, it just
// omits them). Before the fix, loadPluginCatalog() built its three marketplace-derived arrays
// (officialSkills/connectors/thirdPartyPlugins) ONLY from --available's output, so the moment
// a user installed ANY marketplace skill or third-party plugin, it vanished from CCodeBox's
// catalog entirely. The fix recovers installed items via a second data source
// (readInstalledPluginDetails: `claude plugin list --json` + on-disk manifest + `claude plugin
// details`). This test reproduces the exact bug scenario — a plugin installed but NOT present
// in FIXTURE_CATALOG's available list — and asserts it shows up in the correct bucket.
test('loadPluginCatalog recovers installed plugins that --available omits entirely', async () => {
  // Pre-seed an installed plugin id that is NOT in FIXTURE_CATALOG — reproduces the real
  // scenario where `claude plugin install` removes the plugin from subsequent --available
  // output. The fixture's fake-claude.mjs reads this state file on every invocation, so
  // writing it before launch means the very first loadPluginCatalog() call already sees
  // the plugin as installed (and excluded from --available).
  const seededId = 'seeded-skill@claude-plugins-official';
  fs.writeFileSync(pluginStatePath, JSON.stringify([seededId]));

  const fresh = await page.evaluate(() => window.electronAPI.claude.loadPluginCatalog());

  // The seeded plugin must NOT have vanished from the catalog — the whole point of the fix.
  // It lands in officialSkills because: its marketplace is 'claude-plugins-official' (split
  // from the id on '@'), and `claude plugin details seeded-skill` returns "MCP servers (0)"
  // (not in FIXTURE_CATALOG, so the fixture defaults to 0 — the safe non-connector default).
  const recovered = fresh.catalog.officialSkills.find((p) => p.name === 'seeded-skill');
  expect(recovered).toBeTruthy();
  expect(recovered?.installed).toBe(true);
  expect(recovered?.description).toBe('Installed fixture plugin: seeded-skill');

  // It must NOT also appear in connectors or thirdPartyPlugins (no duplication).
  expect(fresh.catalog.connectors.find((p) => p.name === 'seeded-skill')).toBeUndefined();
  expect(fresh.catalog.thirdPartyPlugins.find((p) => p.name === 'seeded-skill')).toBeUndefined();
});

// A connector installed via `claude plugin install` must be recovered into the connectors
// bucket (not thirdPartyPlugins) — the fixture's `details` action returns "MCP servers (1)"
// for plugins whose FIXTURE_CATALOG source is under ./external_plugins/, and
// readInstalledPluginDetails parses that to set hasMcpServers:true, which routes the entry
// into connectors in the merge loop.
test('loadPluginCatalog recovers an installed connector into the connectors bucket', async () => {
  // Pre-seed demo-connector as already installed — it's in FIXTURE_CATALOG under
  // ./external_plugins/, so the fixture knows it's a connector (MCP-server-backed).
  fs.writeFileSync(pluginStatePath, JSON.stringify(['demo-connector@ccodebox-fixture']));

  const fresh = await page.evaluate(() => window.electronAPI.claude.loadPluginCatalog());

  // demo-connector was removed from --available's output (fixture mirrors the real CLI's
  // exclude-installed behavior), but readInstalledPluginDetails recovers it into connectors.
  const recovered = fresh.catalog.connectors.find((p) => p.name === 'demo-connector');
  expect(recovered).toBeTruthy();
  expect(recovered?.installed).toBe(true);
});

// UI test: the "已安装" filter tab is now a real, working filter present in all three
// top-level tabs (连接器/插件/技能), replacing the old decorative icon-row that sat above
// the connector filter tabs. This test exercises it on the connectors tab: pre-seeds an
// installed connector, navigates to the connectors view, clicks 已安装, and asserts the
// installed connector shows up there (instead of being invisible as it was before the fix).
test('connectors 已安装 filter tab shows installed connectors', async () => {
  // Pre-seed demo-connector as installed so it's recovered via readInstalledPluginDetails
  // (and excluded from --available's output) — no 2-second install wait needed.
  fs.writeFileSync(pluginStatePath, JSON.stringify(['demo-connector@ccodebox-fixture']));

  await page.getByRole('button', { name: '插件' }).click();

  // The 已安装 filter tab must exist as a real button in the connector filter row. Scope to
  // the filter-tabs container (div.flex.items-center.gap-1.mb-6) to disambiguate from the
  // "已安装" state label on the InstallButton of the already-installed demo-connector card,
  // which also matches getByRole('button', { name: '已安装' }) — a strict-mode violation
  // otherwise (the filter tab is the one in the filter row, the card button is in the grid).
  const filterRow = page.locator('div.flex.items-center.gap-1.mb-6');
  await expect(filterRow.getByRole('button', { name: '已安装' })).toBeVisible();

  // Click it and verify the installed connector shows up (recovered by the fix, not vanished).
  await filterRow.getByRole('button', { name: '已安装' }).click();
  await expect(page.getByText('demo-connector', { exact: true })).toBeVisible();

  // The installed connector card must show the "已安装" button state (not "安装"), proving
  // the recovered entry has installed:true — the same state a freshly-installed connector
  // would show, not a phantom catalog entry with no install state.
  const card = page.locator('.border-card-border', { hasText: 'demo-connector' });
  await expect(card.getByRole('button', { name: '已安装' })).toBeVisible();
});

// The old decorative "已安装" icon-row section that sat ABOVE the connector filter tabs has
// been removed — it was redundant with the new working 已安装 filter tab. Verify it's gone
// so the UI doesn't regress to showing both at once.
test('connectors view no longer renders the old decorative 已安装 icon-row section', async () => {
  // Even with installed connectors + custom MCP servers present, the old icon-row (which
  // rendered as a <h2>已安装</h2> heading above the filter tabs) must not appear — the
  // filter tab itself is the single source of truth now.
  fs.writeFileSync(pluginStatePath, JSON.stringify(['demo-connector@ccodebox-fixture']));

  await page.getByRole('button', { name: '插件' }).click();

  // On the default 官方 filter tab, there should be no <h2>已安装</h2> heading (the old
  // icon-row section). The only "已安装" on this view should be the filter tab button.
  // Scope to h2 headings specifically — the filter button is a <button>, not an <h2>.
  await expect(page.locator('h2', { hasText: '已安装' })).toHaveCount(0);
});
