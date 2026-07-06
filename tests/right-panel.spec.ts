import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { execSync } from 'node:child_process';
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

test.describe('right panel: files tab', () => {
  let userDataDir: string;
  let repoDir: string;
  let projectsDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-userdata-'));

    // A real git repo fixture covering all four statuses FilesPanel must render distinctly.
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-files-repo-'));
    execSync('git init -q', { cwd: repoDir });
    execSync('git config user.email test@test.com', { cwd: repoDir });
    execSync('git config user.name test', { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, 'modified.txt'), 'original\n');
    fs.writeFileSync(path.join(repoDir, 'deleted.txt'), 'bye\n');
    execSync('git add modified.txt deleted.txt', { cwd: repoDir });
    execSync('git commit -q -m initial', { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, 'modified.txt'), 'changed\n');
    fs.rmSync(path.join(repoDir, 'deleted.txt'));
    fs.writeFileSync(path.join(repoDir, 'added.txt'), 'new file\n');
    execSync('git add added.txt deleted.txt', { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, 'untracked.txt'), 'untracked content\nsecond line\n');

    // historyReader trusts the jsonl message line's own `cwd` field, not the directory name
    // (directory-name decoding is lossy — see historyReader.ts), so a plain fixture dir name is fine.
    projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-projects-'));
    const sessionDir = path.join(projectsDir, 'fake-project');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, 'session-1.jsonl'),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' }, cwd: repoDir, uuid: 'u1' }) + '\n',
    );

    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, CCODEBOX_CLAUDE_BIN: FAKE_CLAUDE_BIN, CCODEBOX_PROJECTS_DIR: projectsDir },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Select the fixture project via the picker so the right panel's cwd resolves to repoDir.
    const trigger = page.locator('main button:has(svg.lucide-file-text)');
    await trigger.click();
    const menu = page.locator('main .absolute.bottom-full');
    await menu.getByRole('button', { name: path.basename(repoDir) }).click();
    await expect(trigger).toContainText(path.basename(repoDir));
  });

  test.afterEach(async () => {
    await closeApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(projectsDir, { recursive: true, force: true });
  });

  test('renders all four git statuses with correct labels and real diff content', async () => {
    await page.locator('main button:has(svg.lucide-panel-right-open)').click();
    await page.getByRole('button', { name: '审查', exact: true }).click();

    await expect(page.getByText('已编辑 4 个文件')).toBeVisible();
    await expect(page.getByText('+4')).toBeVisible();
    await expect(page.getByText('-2')).toBeVisible();

    const modifiedRow = page.locator('button:visible', { hasText: 'modified.txt' });
    await expect(modifiedRow.locator('span').first()).toHaveText('M');
    await modifiedRow.click();
    await expect(page.getByText('-original')).toBeVisible();
    await expect(page.getByText('+changed')).toBeVisible();

    await expect(page.locator('button:visible', { hasText: 'deleted.txt' }).locator('span').first()).toHaveText('D');
    await expect(page.locator('button:visible', { hasText: 'added.txt' }).locator('span').first()).toHaveText('A');

    const untrackedRow = page.locator('button:visible', { hasText: 'untracked.txt' });
    await expect(untrackedRow.locator('span').first()).toHaveText('U');
    await untrackedRow.click();

    // Regression check for a real bug: the untracked-file preview used to leave a stray
    // trailing '+' line — assert the exact text content, not just a substring match.
    const diffText = await page.locator('pre').textContent();
    expect(diffText).toBe('+untracked content+second line');
  });
});

test.describe('right panel: terminal tab', () => {
  let userDataDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-userdata-'));
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, CCODEBOX_CLAUDE_BIN: FAKE_CLAUDE_BIN },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await closeApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('spawns a real shell and echoes real command output', async () => {
    await page.locator('main button:has(svg.lucide-panel-right-open)').click();
    await page.getByRole('button', { name: '终端' }).click();
    await page.locator('.xterm-rows').waitFor({ state: 'visible' });

    const marker = 'CCODEBOX_TERMINAL_TEST_MARKER';
    await page.locator('.xterm').click();
    await page.keyboard.type(`echo ${marker}`);
    await page.keyboard.press('Enter');

    await page.waitForFunction(
      (m) => document.querySelector('.xterm-rows')?.innerText.includes(m),
      marker,
      { timeout: 10000 },
    );
  });

  test('switching tabs and back keeps the same shell session alive (sticky mount)', async () => {
    await page.locator('main button:has(svg.lucide-panel-right-open)').click();
    await page.getByRole('button', { name: '终端' }).click();
    await page.locator('.xterm-rows').waitFor({ state: 'visible' });

    const marker = 'CCODEBOX_STICKY_TEST_MARKER';
    await page.locator('.xterm').click();
    await page.keyboard.type(`export CCODEBOX_STICKY_VAR=${marker}`);
    await page.keyboard.press('Enter');
    // Wait for the pty to echo the typed command back, proving it was received, then give
    // the shell a moment to actually process the (silent, no-output) export before switching.
    await page.waitForFunction(
      () => document.querySelector('.xterm-rows')?.innerText.includes('CCODEBOX_STICKY_VAR='),
      { timeout: 10000 },
    );
    await page.waitForTimeout(300);

    // Switch away to the other two tabs and back — a fresh shell would not have the var set.
    await page.getByRole('button', { name: '文件' }).click();
    await page.getByRole('button', { name: '浏览器' }).click();
    await page.getByRole('button', { name: '终端' }).click();

    await page.locator('.xterm').click();
    await page.keyboard.type('echo $CCODEBOX_STICKY_VAR');
    await page.keyboard.press('Enter');

    await page.waitForFunction(
      (m) => document.querySelector('.xterm-rows')?.innerText.includes(m),
      marker,
      { timeout: 10000 },
    );
  });
});

test.describe('right panel: browser tab', () => {
  let userDataDir: string;
  let app: ElectronApplication;
  let page: Page;
  const fixtureHtml = path.join(__dirname, 'fixtures/browser-panel-test.html');

  test.beforeEach(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-userdata-'));
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, CCODEBOX_CLAUDE_BIN: FAKE_CLAUDE_BIN },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await closeApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  // Playwright's Electron driver cannot pierce into a <webview> guest's own DOM (confirmed:
  // page.frames() never lists it and .contentFrame() explicitly requires an <iframe>), so
  // these assert on the <webview> element's own src attribute — the actual CCodeBox logic
  // under test — rather than the rendered guest content, which is Chromium's job, not ours.
  test('a full URL with scheme loads unmodified into the embedded webview', async () => {
    await page.locator('main button:has(svg.lucide-panel-right-open)').click();
    await page.getByRole('button', { name: '浏览器' }).click();

    const urlInput = page.getByPlaceholder('输入网址...');
    await urlInput.fill(`file://${fixtureHtml}`);
    await urlInput.press('Enter');

    await expect(page.locator('webview')).toHaveAttribute('src', `file://${fixtureHtml}`);
  });

  test('a bare hostname is normalized to https:// before being loaded', async () => {
    await page.locator('main button:has(svg.lucide-panel-right-open)').click();
    await page.getByRole('button', { name: '浏览器' }).click();

    const urlInput = page.getByPlaceholder('输入网址...');
    await urlInput.fill('example.com');
    await urlInput.press('Enter');

    await expect(page.locator('webview')).toHaveAttribute('src', 'https://example.com');
    await expect(urlInput).toHaveValue('https://example.com');
  });

  test('back/forward buttons enable after two navigations and correctly traverse history', async () => {
    await page.locator('main button:has(svg.lucide-panel-right-open)').click();
    await page.getByRole('button', { name: '浏览器' }).click();

    const urlInput = page.getByPlaceholder('输入网址...');
    const backButton = page.locator('button:has(svg.lucide-chevron-left)');
    const forwardButton = page.locator('button:has(svg.lucide-chevron-right):not(:has(svg.lucide-folder))');
    const fixtureHtml2 = path.join(__dirname, 'fixtures/browser-panel-test-2.html');

    await expect(backButton).toBeDisabled();
    await expect(forwardButton).toBeDisabled();

    await urlInput.fill(`file://${fixtureHtml}`);
    await urlInput.press('Enter');
    await expect(page.locator('webview')).toHaveAttribute('src', `file://${fixtureHtml}`);
    // Wait for the first page to finish loading before issuing the second navigation: a
    // loadURL triggered while the previous load hasn't committed yet is treated by Chromium
    // as a history *replacement* rather than a push, which would leave canGoBack false even
    // after two genuinely distinct URLs. Real users can't type this fast, but the test can.
    await page.waitForFunction(
      () => !(document.querySelector('webview') as any)?.isLoading?.(),
    );

    // A second, genuinely distinct URL guarantees a real did-navigate (unlike a hash-only
    // change, whose in-page-vs-full-navigation classification isn't worth depending on here).
    await urlInput.fill(`file://${fixtureHtml2}`);
    await urlInput.press('Enter');
    await expect(page.locator('webview')).toHaveAttribute('src', `file://${fixtureHtml2}`);
    await expect(backButton).toBeEnabled();
    await expect(forwardButton).toBeDisabled();

    await backButton.click();
    await expect(urlInput).toHaveValue(`file://${fixtureHtml}`);
    await expect(forwardButton).toBeEnabled();

    await forwardButton.click();
    await expect(urlInput).toHaveValue(`file://${fixtureHtml2}`);
  });

  test('reload button re-fetches the current page without navigating away', async () => {
    await page.locator('main button:has(svg.lucide-panel-right-open)').click();
    await page.getByRole('button', { name: '浏览器' }).click();

    const urlInput = page.getByPlaceholder('输入网址...');
    await urlInput.fill(`file://${fixtureHtml}`);
    await urlInput.press('Enter');
    await expect(page.locator('webview')).toHaveAttribute('src', `file://${fixtureHtml}`);

    const reloadButton = page.locator('button:has(svg.lucide-rotate-cw)');
    await reloadButton.click();

    // Reload must not change the loaded URL or wipe the history built up before it.
    await expect(page.locator('webview')).toHaveAttribute('src', `file://${fixtureHtml}`);
    await expect(urlInput).toHaveValue(`file://${fixtureHtml}`);
  });
});
