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

test.describe('input bar features', () => {
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

  test('slash command autocomplete menu shows real commands, filters, and inserts selection', async () => {
    // Start a new chat from the home screen — the session-ready event carrying the fake
    // fixture's slash_commands list is emitted immediately on process start.
    const homeInput = page.getByPlaceholder('随心输入');
    await homeInput.fill('hello');
    await page.locator('button:has(svg.lucide-arrow-up)').click();

    const chatInput = page.getByPlaceholder('要求后续变更');
    await expect(chatInput).toBeVisible({ timeout: 5000 });
    // Wait for the first turn to complete so the session is fully initialized; the
    // session-ready event arrives right at process start, well before this point.
    await expect(page.getByText(/fake-reply: hello/)).toBeVisible({ timeout: 5000 });

    // Typing "/" alone opens the menu.
    await chatInput.fill('/');
    const menu = page.getByTestId('slash-command-menu');
    await expect(menu).toBeVisible({ timeout: 5000 });

    // Real items from the fixture's slash_commands list should appear. `clear` is a
    // hardcoded built-in; `demo-skill` only exists in the fixture's plugin catalog, so its
    // presence proves the catalog-description cross-reference path executed end to end.
    await expect(page.getByTestId('slash-command-item-clear')).toBeVisible();
    await expect(page.getByTestId('slash-command-item-demo-skill')).toBeVisible();
    await expect(page.getByTestId('slash-command-item-compact')).toBeVisible();
    await expect(page.getByTestId('slash-command-item-context')).toBeVisible();
    await expect(page.getByTestId('slash-command-item-review')).toBeVisible();

    // Narrow the filter by typing more characters — only matching items remain.
    await chatInput.fill('/cle');
    await expect(page.getByTestId('slash-command-item-clear')).toBeVisible();
    await expect(page.getByTestId('slash-command-item-context')).toHaveCount(0);
    await expect(page.getByTestId('slash-command-item-compact')).toHaveCount(0);
    await expect(page.getByTestId('slash-command-item-demo-skill')).toHaveCount(0);

    // Select `clear` (mouse click). The textarea should receive `/clear ` (with a trailing
    // space) and the menu should close — the command is NOT auto-sent.
    await page.getByTestId('slash-command-item-clear').click();
    await expect(chatInput).toHaveValue('/clear ');
    await expect(menu).toHaveCount(0);

    // Confirm no fake reply for `/clear` snuck through (the command wasn't sent).
    await expect(page.getByText(/fake-reply: \/clear/)).toHaveCount(0);
  });

  test('message queueing while a turn is in-flight queues and auto-sends once the turn completes', async () => {
    const homeInput = page.getByPlaceholder('随心输入');
    await homeInput.fill('first queued test');
    await page.locator('button:has(svg.lucide-arrow-up)').click();

    const chatInput = page.getByPlaceholder('要求后续变更');
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Immediately type and send a second message while the first turn is still in flight.
    // Don't wait for the first reply — the whole point is to queue mid-turn.
    await chatInput.fill('second queued test');
    await chatInput.press('Enter');

    // A queued-message chip should appear showing the second message's text.
    const chip = page.getByTestId('queued-message-chip');
    await expect(chip).toBeVisible({ timeout: 5000 });
    await expect(chip).toContainText('second queued test');

    // Wait for the first reply, then the second (auto-drained from the queue once the
    // first turn completed). Both should appear in the transcript, proving the queued
    // message was actually sent rather than silently dropped.
    await expect(page.getByText(/fake-reply: first queued test/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/fake-reply: second queued test/)).toBeVisible({ timeout: 10000 });

    // The chip should be gone once the queued message has been drained and sent.
    await expect(chip).toHaveCount(0);
  });
});
