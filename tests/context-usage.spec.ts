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

  test('context usage ring auto-populates after the first turn (unthrottled) and reveals category breakdown on hover', async () => {
    // Start a new chat from the home screen.
    const textarea = page.locator('textarea').first();
    await textarea.fill('hello');
    await textarea.press('Enter');
    await expect(page.getByText('fake-reply: hello')).toBeVisible({ timeout: 10000 });

    // The first turn-completed in a session always fires the auto-refresh (the throttle only
    // blocks a *second* fetch within CONTEXT_REFRESH_THROTTLE_MS of the first) — see
    // sessionStore.ts's turn-completed handler.
    const ringContainer = page.getByTestId('context-usage-ring');
    await expect(ringContainer.locator('svg[class*="rotate-90"]')).toBeVisible({ timeout: 10000 });

    // Hovering reveals the breakdown for whatever's already cached (no re-fetch needed).
    await ringContainer.hover();
    const tooltip = page.getByTestId('context-usage-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('System prompt');
    await expect(tooltip).toContainText('Messages');
    await expect(tooltip).toContainText('10.0k');
  });

  test('context usage ring does not re-fetch on a second turn within the throttle window', async () => {
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

    // Still just the cached ring, no stuck "querying" state from a throttled-away second fetch.
    await expect(ringContainer.locator('svg[class*="rotate-90"]')).toBeVisible();
    await ringContainer.hover();
    await expect(page.getByTestId('context-usage-tooltip')).not.toContainText('查询中');
  });
});
