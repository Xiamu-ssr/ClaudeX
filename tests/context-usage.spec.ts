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

  test('shows context usage ring after a turn and reveals category breakdown on hover', async () => {
    // Start a new chat from the home screen.
    const textarea = page.locator('textarea').first();
    await textarea.fill('hello');
    await textarea.press('Enter');

    // Wait for the fake reply to appear — the turn-completed event triggers the
    // automatic refreshContextUsage call that populates the ring.
    await expect(page.getByText('fake-reply: hello')).toBeVisible({ timeout: 10000 });

    // The ring is an SVG with the -rotate-90 Tailwind class (unique to ContextUsageRing).
    // It only renders when contextUsage is non-null, so its presence proves the /context round trip.
    const ring = page.locator('svg[class*="rotate-90"]').first();
    await expect(ring).toBeVisible({ timeout: 10000 });

    // Hover the ring to reveal the tooltip with the category breakdown.
    await ring.hover();
    const tooltip = page.getByTestId('context-usage-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('System prompt');
    await expect(tooltip).toContainText('Messages');
    await expect(tooltip).toContainText('10.0k');
  });
});
