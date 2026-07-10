import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FAKE_CLAUDE_BIN = path.join(__dirname, 'fixtures/fake-claude/fake-claude.mjs');

// app.close() can hang after a child process (ClaudeSession or a terminal pty) was spawned
// during the test — see app.spec.ts's afterEach for the same observed CDP/debugger teardown
// race. Race against a short timeout and force-kill as a fallback.
async function closeApp(app: ElectronApplication) {
  await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  try {
    app.process().kill('SIGKILL');
  } catch {
    // already exited — expected in the common case.
  }
}

test.describe('context usage ring', () => {
  let userDataDir: string;
  let projectsDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-userdata-'));
    projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-projects-'));
    fs.writeFileSync(
      path.join(userDataDir, 'model-providers.json'),
      JSON.stringify([
        {
          id: 'stream-usage-fixture',
          name: 'Stream usage fixture',
          builtin: false,
          env: {},
          models: [{ id: 'fake-model', label: 'Fake model', contextWindowTokens: 200000 }],
        },
      ]),
    );

    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, CCODEBOX_CLAUDE_BIN: FAKE_CLAUDE_BIN, CCODEBOX_PROJECTS_DIR: projectsDir },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await closeApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectsDir, { recursive: true, force: true });
  });

  async function selectFakeModel() {
    await page.getByRole('button', { name: 'Sonnet 5' }).click();
    const pickerMenu = page.locator('.absolute.bottom-full.right-0');
    await pickerMenu.getByRole('button', { name: 'Fake model' }).click();
    await pickerMenu.getByRole('button', { name: 'CLI 默认' }).click();
  }

  test('context usage ring reads normal response usage without sending /context and reveals token breakdown on hover', async () => {
    await selectFakeModel();
    // Start a new chat from the home screen.
    const textarea = page.locator('textarea').first();
    await textarea.fill('hello');
    await textarea.press('Enter');
    await expect(page.getByText('fake-reply: hello')).toBeVisible({ timeout: 10000 });

    const ringContainer = page.getByTestId('context-usage-ring');
    await expect(ringContainer.locator('svg[class*="rotate-90"]')).toBeVisible({ timeout: 10000 });

    // Hovering only reveals metadata that arrived with the normal model response; it must not
    // send the expensive `/context` local command.
    await ringContainer.hover();
    const tooltip = page.getByTestId('context-usage-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('13.0k');
    await expect(tooltip).toContainText('缓存读取');
    await expect(tooltip).toContainText('输出');
  });

  test('context usage ring refreshes from the second normal response without /context polling', async () => {
    await selectFakeModel();
    const textarea = page.locator('textarea').first();
    await textarea.fill('first');
    await textarea.press('Enter');
    await expect(page.getByText('fake-reply: first')).toBeVisible({ timeout: 10000 });

    const ringContainer = page.getByTestId('context-usage-ring');
    await expect(ringContainer.locator('svg[class*="rotate-90"]')).toBeVisible({ timeout: 10000 });

    const chatInput = page.getByPlaceholder('要求后续变更');
    await chatInput.fill('second');
    await chatInput.press('Enter');
    await expect(page.getByText('fake-reply: second')).toBeVisible({ timeout: 10000 });

    // The ring is still populated from the second normal response, with no separate query.
    await expect(ringContainer.locator('svg[class*="rotate-90"]')).toBeVisible();
    await ringContainer.hover();
    await expect(page.getByTestId('context-usage-tooltip')).not.toContainText('查询中');
  });
});
