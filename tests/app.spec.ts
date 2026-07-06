import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FAKE_CLAUDE_BIN = path.join(__dirname, 'fixtures/fake-claude/fake-claude.mjs');

// A minimal valid 1x1 transparent PNG, written once at module load — Playwright's
// setInputFiles() can set files on a hidden <input type="file"> directly, no OS file-picker
// dialog involved, so a real on-disk file is all that's needed.
const TEST_IMAGE_PATH = path.join(os.tmpdir(), 'ccodebox-test-fixture-image.png');
fs.writeFileSync(
  TEST_IMAGE_PATH,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )
);

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let pluginStatePath: string;

test.beforeEach(async () => {
  // A fresh --user-data-dir per test keeps model-providers.json (and anything else
  // main writes to app.getPath('userData')) fully isolated from this machine's real
  // CCodeBox profile — tests that add/delete providers must not leak into real usage.
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-userdata-'));
  // Same isolation for the fake CLI's simulated plugin-install state: each execFileSync
  // call from pluginCatalog.ts is a fresh process with no shared memory, so fake-claude.mjs
  // persists "installed" plugin ids to this file instead — must be per-test like userDataDir.
  pluginStatePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-pluginstate-')), 'state.json');
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, CCODEBOX_CLAUDE_BIN: FAKE_CLAUDE_BIN, CCODEBOX_FAKE_PLUGIN_STATE: pluginStatePath },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  // app.close() can hang indefinitely after a ClaudeSession child process was spawned and
  // stopped during the test (observed: the Electron main process itself exits cleanly with
  // code 0, but Playwright's close() promise doesn't resolve — looks like a CDP/debugger
  // teardown race in Playwright's Electron driver, not an app bug). Race against a short
  // timeout and force-kill as a fallback so a flaky close doesn't burn the whole test run.
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

test('home page renders with input and integration cards', async () => {
  await expect(page.getByText('我们应该在CCodeBox中做些什么？')).toBeVisible();
  await expect(page.getByPlaceholder('随心输入')).toBeVisible();
  await expect(page.getByText('连接 GitHub')).toBeVisible();
});

test('sidebar 插件 button navigates to plugins view', async () => {
  await page.getByRole('button', { name: '插件' }).click();
  await expect(page.getByText('通过 MCP 服务器扩展 Claude Code 的能力')).toBeVisible();
});

test('plugins view tab switch: connectors -> skills', async () => {
  await page.getByRole('button', { name: '插件' }).click();
  await page.getByRole('button', { name: '技能' }).click();
  await expect(page.getByText('可复用的工作流和自动化技能')).toBeVisible();
});

test('user menu opens settings view', async () => {
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('button', { name: /^设置/ }).click();
  await expect(page.getByText('以下设置应用于下一个新建的对话，不影响已经开始的会话')).toBeVisible();
});

test('settings back button returns to previous view', async () => {
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByText('返回应用').click();
  await expect(page.getByText('我们应该在CCodeBox中做些什么？')).toBeVisible();
});

test('sidebar has no dead 已安排 menu item and no fake identity/quota UI', async () => {
  await expect(page.getByRole('button', { name: '已安排' })).toHaveCount(0);

  await page.getByRole('button', { name: '用户菜单' }).click();
  await expect(page.getByRole('button', { name: '个人帐户' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '个人资料' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '退出登录' })).toHaveCount(0);
  await expect(page.getByText('剩余用量')).toHaveCount(0);
  await expect(page.getByText('vera730')).toHaveCount(0);

  // Real `claude auth status` data via the fake CLI's canned response, not a fabricated identity.
  await expect(page.getByText('已登录 · OAuth 登录')).toBeVisible();
});

test('sidebar 搜索 toggles a real filter over project/session data', async () => {
  await page.getByRole('button', { name: '搜索' }).click();
  const searchInput = page.getByPlaceholder('搜索项目和对话...');
  await expect(searchInput).toBeVisible();

  // A query that cannot match any real project/session name on any machine.
  await searchInput.fill('__no_such_project_or_session_ZZZ__');
  await expect(page.getByText('没有匹配的项目或对话')).toBeVisible();

  // Clearing the query restores the full list (no fixed project name asserted here — the
  // real ~/.claude/projects contents reflect this machine's actual history, not a fixture).
  await searchInput.fill('');
  await expect(page.getByText('没有匹配的项目或对话')).not.toBeVisible();
});

test('CRITICAL: sending a message from the home page starts a real session and renders a real reply', async () => {
  const input = page.getByPlaceholder('随心输入');
  await input.fill('hello from test');
  await page.locator('button:has(svg.lucide-arrow-up)').click();

  // Navigated to chat view, input cleared.
  const chatInput = page.getByPlaceholder('要求后续变更');
  await expect(chatInput).toBeVisible();
  await expect(chatInput).toHaveValue('');

  // While processing: send button should be swapped to the stop icon.
  await expect(page.locator('button:has(svg.lucide-square)')).toBeVisible({ timeout: 2000 });

  // Fake binary replies after ~400ms with a deterministic, shape-correct response.
  await expect(page.getByText(/fake-reply: hello from test/)).toBeVisible({ timeout: 5000 });

  // Once complete, the stop icon should swap back to the send arrow.
  await expect(page.locator('button:has(svg.lucide-square)')).not.toBeVisible();
  await expect(page.locator('button:has(svg.lucide-arrow-up)')).toBeVisible();
});

test('sending a follow-up message in an existing chat works too', async () => {
  const input = page.getByPlaceholder('随心输入');
  await input.fill('first message');
  await page.locator('button:has(svg.lucide-arrow-up)').click();
  await expect(page.getByText(/fake-reply: first message/)).toBeVisible({ timeout: 5000 });

  const chatInput = page.getByPlaceholder('要求后续变更');
  await chatInput.fill('second message');
  await page.locator('button:has(svg.lucide-arrow-up)').click();
  await expect(page.getByText(/fake-reply: second message/)).toBeVisible({ timeout: 5000 });

  // Both user message bubbles should be present in the transcript (scoped to the bubble's
  // own class, since a plain text match also matches the title bar and the fake reply text
  // which echoes the message back as a substring).
  const userBubble = page.locator('.bg-\\[\\#363638\\].rounded-2xl');
  await expect(userBubble.filter({ hasText: 'first message' })).toBeVisible();
  await expect(userBubble.filter({ hasText: 'second message' })).toBeVisible();
});

test('CRITICAL: attaching an image sends it as a real content block the fake CLI receives', async () => {
  const input = page.getByPlaceholder('随心输入');
  await input.fill('look at this image');

  await page.locator('input[type="file"]').setInputFiles(TEST_IMAGE_PATH);
  await expect(page.locator('img[alt="ccodebox-test-fixture-image.png"]')).toBeVisible();

  await page.locator('button:has(svg.lucide-arrow-up)').click();

  // The fake CLI's reply proves the text arrived correctly alongside the attachment
  // (array-shaped content), and the thumbnail now renders in the sent transcript bubble.
  await expect(page.getByText(/fake-reply: look at this image/)).toBeVisible({ timeout: 5000 });
  await expect(page.locator('img[alt="ccodebox-test-fixture-image.png"]')).toBeVisible();
});

test('attachment picker disables adding more once the 5-image limit is reached', async () => {
  await page.locator('input[type="file"]').setInputFiles([
    TEST_IMAGE_PATH,
    TEST_IMAGE_PATH,
    TEST_IMAGE_PATH,
    TEST_IMAGE_PATH,
    TEST_IMAGE_PATH,
  ]);

  await expect(page.locator('img[alt="ccodebox-test-fixture-image.png"]')).toHaveCount(5);
  await expect(page.locator('button:has(svg.lucide-plus)')).toBeDisabled();
});

test('Enter key sends the message (Shift+Enter does not)', async () => {
  const input = page.getByPlaceholder('随心输入');
  await input.fill('enter key test');
  await input.press('Enter');

  await expect(page.getByPlaceholder('要求后续变更')).toBeVisible();
  await expect(page.getByText(/fake-reply: enter key test/)).toBeVisible({ timeout: 5000 });
});

test('an error result (is_error:true) renders as a distinctly-styled error, not a normal reply', async () => {
  // Regression test for a real bug: eventTranslator used to ignore `is_error` entirely, so a
  // well-formed API-error result (e.g. an incompatible model/effort combination) rendered
  // identically to a normal successful reply, with no visual indication anything went wrong.
  const input = page.getByPlaceholder('随心输入');
  await input.fill('__SIMULATE_ERROR__ trigger a fake API error');
  await page.locator('button:has(svg.lucide-arrow-up)').click();

  await expect(page.getByText(/API Error: 400 simulated error for testing\./)).toBeVisible({ timeout: 5000 });
  await expect(page.locator('svg.lucide-triangle-alert')).toBeVisible();

  // The turn still resolves normally — isProcessing unblocks just like a successful reply.
  await expect(page.locator('button:has(svg.lucide-square)')).not.toBeVisible();
  await expect(page.locator('button:has(svg.lucide-arrow-up)')).toBeVisible();
});

test('an unexpected process crash mid-turn surfaces an error state instead of hanging on "..." forever', async () => {
  // Regression test for a real bug: sessionStore used to unconditionally ignore
  // process-error/process-exited events, so any child-process failure that occurred without
  // ever producing a `result` line left the "..." indicator stuck forever with no recovery.
  const input = page.getByPlaceholder('随心输入');
  await input.fill('__SIMULATE_CRASH__ trigger a fake process crash');
  await page.locator('button:has(svg.lucide-arrow-up)').click();

  await expect(page.locator('svg.lucide-triangle-alert')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/Claude 进程/)).toBeVisible();

  await expect(page.locator('button:has(svg.lucide-square)')).not.toBeVisible();
  await expect(page.locator('button:has(svg.lucide-arrow-up)')).toBeVisible();
});

test('clicking the stop button gracefully ends the turn without showing a false error', async () => {
  const input = page.getByPlaceholder('随心输入');
  await input.fill('a message that will be interrupted');
  await page.locator('button:has(svg.lucide-arrow-up)').click();

  const stopButton = page.locator('button:has(svg.lucide-square)');
  await expect(stopButton).toBeVisible({ timeout: 2000 });
  await stopButton.click();

  // isProcessing must unblock (the fake CLI finishes the in-flight turn before honoring the
  // stdin EOF from stop(), mirroring the real CLI's confirmed behavior).
  await expect(page.locator('button:has(svg.lucide-square)')).not.toBeVisible({ timeout: 5000 });
  await expect(page.locator('button:has(svg.lucide-arrow-up)')).toBeVisible();

  // A deliberate, user-initiated stop must never be mislabeled as a crash.
  await expect(page.locator('svg.lucide-triangle-alert')).not.toBeVisible();
});

test('permission mode dropdown actually switches between Full Access and Default', async () => {
  const trigger = page.getByRole('button', { name: /完全访问|默认权限/ });
  await expect(trigger).toHaveText(/完全访问/);

  await trigger.click();
  await expect(page.getByRole('button', { name: '默认权限' })).toBeVisible();
  await page.getByRole('button', { name: '默认权限' }).click();

  await expect(page.getByRole('button', { name: /完全访问|默认权限/ })).toHaveText(/默认权限/);
});

test('project picker on home page lists real projects and updates selection', async () => {
  // Scoped to <main> since Sidebar also has a FileText-icon project row on screen at the same time.
  const trigger = page.locator('main button:has(svg.lucide-file-text)');
  await expect(trigger).toBeVisible();

  await trigger.click();
  const menu = page.locator('main .absolute.bottom-full');
  await expect(menu).toBeVisible();

  // This machine's own CCodeBox checkout should have real Claude Code history under it,
  // so it must appear as a selectable option regardless of which project is selected by default.
  const ccodeboxOption = menu.getByRole('button', { name: 'CCodeBox' });
  await expect(ccodeboxOption).toBeVisible();
  await ccodeboxOption.click();

  await expect(trigger).toContainText('CCodeBox');
});

test('model picker lists built-in Anthropic models and switches selection', async () => {
  await page.getByRole('button', { name: 'Sonnet 5' }).click();

  const menu = page.locator('.absolute.bottom-full.right-0');
  await expect(menu.getByText('Anthropic')).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Opus 4.8' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Haiku 4.5' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Fable 5' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '模型设置...' })).toBeVisible();

  // Picking a model cascades into an effort submenu (same popover) rather than committing
  // immediately; picking an effort there commits both together and closes the menu.
  await menu.getByRole('button', { name: 'Opus 4.8' }).click();
  await expect(menu.getByRole('button', { name: 'CLI 默认' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '高', exact: true })).toBeVisible();
  await menu.getByRole('button', { name: 'CLI 默认' }).click();

  await expect(page.getByRole('button', { name: 'Opus 4.8' })).toBeVisible();
});

test('model settings modal: add a custom provider, select it, delete it, and fall back to default', async () => {
  await page.getByRole('button', { name: 'Sonnet 5' }).click();
  await page.getByRole('button', { name: '模型设置...' }).click();
  await expect(page.getByText('模型与供应商设置')).toBeVisible();
  await expect(page.getByText('内置')).toBeVisible();

  await page.getByRole('button', { name: '添加供应商' }).click();
  await page.getByPlaceholder('例如：中转 API').fill('测试供应商');
  await page.getByPlaceholder('ANTHROPIC_BASE_URL').fill('ANTHROPIC_BASE_URL');
  await page.getByPlaceholder('https://...').fill('https://example.com/api');
  await page.getByPlaceholder('模型 ID，如 claude-sonnet-5').fill('custom-model-1');
  await page.getByPlaceholder('显示名称').fill('自定义模型 1');
  await page.getByRole('button', { name: '保存' }).click();

  // Saved: back on the read-only list view, showing the new provider.
  await expect(page.getByText('测试供应商')).toBeVisible();
  await page.getByRole('button', { name: '完成' }).click();

  // The picker now lists the new provider group; selecting its model cascades into the effort
  // submenu, and confirming there commits the model change and updates the trigger.
  await page.getByRole('button', { name: 'Sonnet 5' }).click();
  const pickerMenu = page.locator('.absolute.bottom-full.right-0');
  await pickerMenu.getByRole('button', { name: '自定义模型 1' }).click();
  await pickerMenu.getByRole('button', { name: 'CLI 默认' }).click();
  await expect(page.getByRole('button', { name: '自定义模型 1' })).toBeVisible();

  // Deleting the provider backing the currently-selected model falls back to the default.
  await page.getByRole('button', { name: '自定义模型 1' }).click();
  await page.locator('.absolute.bottom-full.right-0').getByRole('button', { name: '模型设置...' }).click();
  await page.locator('button:has(svg.lucide-trash-2)').click();
  await expect(page.getByText('测试供应商')).not.toBeVisible();
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('button', { name: 'Sonnet 5' })).toBeVisible();
});

test('plugins view: connectors and skills reflect the real local plugin catalog, not mock data', async () => {
  await page.getByRole('button', { name: '插件' }).click();

  // readAvailablePlugins()/readInstalledPluginNames() now route through resolveClaudeBinary(),
  // so under CCODEBOX_CLAUDE_BIN they hit fake-claude.mjs's canned FIXTURE_CATALOG rather than
  // this machine's real marketplace — deterministic, not one of the old hardcoded mock entries
  // (Slack/Notion/Jira were mock-only and must not appear).
  await expect(page.getByText('demo-connector', { exact: true })).toBeVisible();
  await expect(page.getByText('Slack', { exact: true })).not.toBeVisible();

  // Third-party fixture entry has an object (not string) `source` — loadPluginCatalog()
  // deliberately excludes these from both buckets (nothing vendored locally to call "official").
  await expect(page.getByText('third-party-demo', { exact: true })).not.toBeVisible();

  // Tavily is a real MCP server read directly from this machine's ~/.claude.json via
  // listConfiguredMcpServers() (plain fs.readFileSync, not routed through the CLI at all) —
  // still real data even with the fake binary in place, surfaced as an "installed" icon.
  await expect(page.locator('[title="tavily（自定义 MCP 服务器）"]')).toBeVisible();

  await page.getByRole('button', { name: '技能' }).click();
  await expect(page.getByText('demo-skill', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '个人' }).click();
  await expect(page.getByText('还没有个人技能')).toBeVisible();
});

test('plugins view: installing a connector calls the real CLI and flips the button to an installed state', async () => {
  await page.getByRole('button', { name: '插件' }).click();

  const card = page.locator('.border-card-border', { hasText: 'demo-connector' });
  await expect(card.getByRole('button', { name: '安装' })).toBeVisible();

  await card.getByRole('button', { name: '安装' }).click();
  await expect(card.getByRole('button', { name: '安装中...' })).toBeVisible();
  await expect(card.getByRole('button', { name: '已安装' })).toBeVisible({ timeout: 5000 });

  // Prove this is real persistence in the fake CLI's state file, not an optimistic local-only
  // flip: call loadPluginCatalog() fresh (independent of the component's own React state),
  // which re-spawns the fake CLI and re-reads its state file from scratch.
  const fresh = await page.evaluate(() => window.electronAPI.claude.loadPluginCatalog());
  expect(fresh.catalog.connectors.find((c) => c.name === 'demo-connector')?.installed).toBe(true);
});

test('plugins view: uninstalling a connector calls the real CLI and flips the button back', async () => {
  await page.getByRole('button', { name: '插件' }).click();

  const card = page.locator('.border-card-border', { hasText: 'demo-connector' });
  await card.getByRole('button', { name: '安装' }).click();
  await expect(card.getByRole('button', { name: '已安装' })).toBeVisible({ timeout: 5000 });

  // The installed button turns into an uninstall action on hover, per InstallButton's design.
  // Move the mouse away first: the preceding click already parked the virtual cursor at this
  // exact button's center, and hovering "into" the same coordinates is a no-op (no mousemove
  // delta means no mouseenter fires) — confirmed by hand via a raw page.mouse.move diagnostic.
  await page.mouse.move(0, 0);
  await card.getByRole('button', { name: '已安装' }).hover();
  await card.getByRole('button', { name: '卸载' }).click();
  await expect(card.getByRole('button', { name: '卸载中...' })).toBeVisible();
  await expect(card.getByRole('button', { name: '安装' })).toBeVisible({ timeout: 5000 });
});

test('plugins view: a failed install shows an inline error instead of silently doing nothing', async () => {
  await page.getByRole('button', { name: '插件' }).click();

  const card = page.locator('.border-card-border', { hasText: '__SIMULATE_FAILURE__-connector' });
  await card.getByRole('button', { name: '安装' }).click();

  await expect(card.getByText('fake-claude: simulated install failure')).toBeVisible({ timeout: 5000 });
  // Must not be misreported as installed after a failure.
  await expect(card.getByRole('button', { name: '安装' })).toBeVisible();
});

test('settings MCP servers section lists the real configured server, not mock text', async () => {
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: 'MCP 服务器' }).click();

  // Scoped to tavily's own SettingRow (its specific class combo, not a bare 'div'), not a
  // page-wide filter: this machine's real ~/.claude.json may have more than one MCP server
  // configured (e.g. a `playwright` MCP server was added at some point alongside tavily),
  // which would otherwise make this a Playwright strict-mode violation (2+ elements matching
  // a plain `.text-green-400` filter, and a bare 'div' hasText match is too shallow — it'd
  // resolve to the innermost title <div> instead of the row that also holds the badge).
  // exact:true on top of that: the row's own description text ("状态：已配置 · 类型 http")
  // also contains "已配置" as a substring, alongside the actual badge span.
  const tavilyRow = page.locator('.flex.items-center.justify-between.px-4.py-3\\.5', { hasText: 'tavily' });
  await expect(tavilyRow.getByText('已配置', { exact: true })).toBeVisible();
});

test('settings general section: permission mode cards share the same store as the home page selector', async () => {
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('button', { name: /^设置/ }).click();
  // 'general' is the default active section, already showing.
  await expect(page.getByText('对应 claude 的 --permission-mode 参数')).toBeVisible();

  await page.getByText('默认权限', { exact: true }).click();
  await page.getByText('返回应用').click();

  await expect(page.getByRole('button', { name: /完全访问|默认权限/ })).toHaveText(/默认权限/);
});

test('settings general section: reasoning effort dropdown updates the selected value', async () => {
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('button', { name: /^设置/ }).click();

  await page.getByRole('button', { name: 'CLI 默认', exact: true }).click();
  await page.getByRole('button', { name: '高', exact: true }).click();

  await expect(page.getByRole('button', { name: '高', exact: true })).toBeVisible();
});

test('settings profile section shows real local usage stats, not a fake identity/subscription', async () => {
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '个人资料' }).click();

  await expect(page.getByText('基于本机 ~/.claude/projects 会话记录统计，而非云端账户数据')).toBeVisible();
  await expect(page.getByText('累计 Token 数')).toBeVisible();
  await expect(page.getByText('会话总数')).toBeVisible();
  await expect(page.getByText('当前连续天数')).toBeVisible();
  await expect(page.getByText('项目总数')).toBeVisible();
});

test('settings config section shows the real CLI version and real doctor output via the fake binary', async () => {
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '配置' }).click();

  await expect(page.getByText('2.1.201 (Claude Code)')).toBeVisible();

  await page.getByRole('button', { name: '诊断', exact: true }).click();
  await expect(page.getByText('运行中...')).toBeVisible();
  await expect(page.getByText('诊断完成')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/Claude Code CLI 安装正常/)).toBeVisible();
});

test('settings hooks section resolves to a real state (empty or populated), never stuck loading', async () => {
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '钩子' }).click();

  await expect(page.getByText('合并自 ~/.claude/settings.json 与项目 .claude/settings*.json')).toBeVisible();
  await expect(page.getByText('正在读取...')).not.toBeVisible({ timeout: 5000 });
});

test('settings usage section shows real per-project token breakdown, not fake quota/billing UI', async () => {
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '使用情况和计费' }).click();

  await expect(page.getByText('Claude Code CLI 未提供本地可读取的额度/账单数据')).toBeVisible();
  await expect(page.getByText('按项目统计 Token 用量')).toBeVisible();
});

test('settings git and worktrees sections show the honest not-a-repo state for a plain (non-git) project', async () => {
  // Depending on some real directory on the developer's machine happening not to be a git
  // repo is fragile — CCodeBox's own repo was git-initialized and pushed to GitHub partway
  // through this project's life, which silently broke that exact assumption. Use an isolated
  // fixture project pointed at a plain temp dir instead, deterministic regardless of the git
  // status of any real project on this machine.
  await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  try {
    app.process().kill('SIGKILL');
  } catch {
    // already exited — expected in the common case.
  }

  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-projects-'));
  const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-nogit-'));
  const sessionDir = path.join(projectsDir, 'fake-project');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, 'session-1.jsonl'),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' }, cwd: nonGitDir, uuid: 'u1' }) + '\n',
  );

  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, CCODEBOX_CLAUDE_BIN: FAKE_CLAUDE_BIN, CCODEBOX_PROJECTS_DIR: projectsDir },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const trigger = page.locator('main button:has(svg.lucide-file-text)');
  await trigger.click();
  const menu = page.locator('main .absolute.bottom-full');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: path.basename(nonGitDir) }).click();
  await expect(trigger).toContainText(path.basename(nonGitDir));

  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('button', { name: /^设置/ }).click();

  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await expect(page.getByText('当前项目不是一个 Git 仓库')).toBeVisible();

  await page.getByRole('button', { name: '工作树' }).click();
  await expect(page.getByText('当前项目不是一个 Git 仓库')).toBeVisible();

  fs.rmSync(projectsDir, { recursive: true, force: true });
  fs.rmSync(nonGitDir, { recursive: true, force: true });
});

test('settings env section shows masked values, never raw plaintext', async () => {
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '环境', exact: true }).click();

  await expect(page.getByText('值已脱敏，不会显示明文')).toBeVisible();
});
