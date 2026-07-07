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

test.describe('file preview in main content area', () => {
  let userDataDir: string;
  let repoDir: string;
  let projectsDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-userdata-'));

    // A plain project directory (git not required for file preview — the Files tab lists any
    // real directory) containing a real .ts file with recognizable TypeScript content.
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-preview-repo-'));
    fs.writeFileSync(
      path.join(repoDir, 'hello.ts'),
      "export function hello(): string {\n  return 'world';\n}\n",
    );

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

    // The fixture directory contains exactly one project, so it auto-selects as
    // selectedProjectCwd once the Sidebar's mount-time loadProjectList() resolves (see
    // sessionStore.ts's "projects[0] when nothing was previously selected" fallback) — wait
    // for it to appear rather than driving a project switcher (there is none on the Home screen).
    await expect(page.locator('aside').first().getByText(path.basename(repoDir))).toBeVisible();
  });

  test.afterEach(async () => {
    await closeApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(projectsDir, { recursive: true, force: true });
  });

  test('clicking a file in the tree renders highlighted content in the main area, not the right panel', async () => {
    // Open the right panel (Files tab is the default, but click it explicitly to be safe).
    await page.locator('main button:has(svg.lucide-panel-right-open)').click();
    await page.getByRole('button', { name: '文件', exact: true }).click();

    // Sidebar is always the first <aside>; the right panel (when open) is the second, so
    // `.last()` unambiguously targets it regardless of either one's internal classes (both
    // Sidebar and RightPanel render an <aside>, so a bare 'aside' locator matches 2 elements).
    const rightPanelAside = page.locator('aside').last();

    // Click the .ts file in the file tree (the right panel stays mounted alongside the preview).
    const fileRow = rightPanelAside.locator('button:visible', { hasText: 'hello.ts' });
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    // The file's content must now be visible in the MAIN content area (the new FilePreviewPane,
    // which is the only <main> rendered while a preview is active — MainContent's <main> is
    // replaced by it), proving the preview moved out of the right panel into the center.
    const mainContent = page.locator('main');
    await expect(mainContent).toContainText("export function hello");
    await expect(mainContent).toContainText("return 'world'");

    // The right panel's own file-tree area must still be showing the tree (both visible at
    // once, side by side — the whole point of the VS-Code-style split).
    await expect(rightPanelAside).toBeVisible();
    await expect(fileRow).toBeVisible();
    // And the raw source must NOT have leaked into the right panel's tree area.
    await expect(rightPanelAside).not.toContainText("export function hello");

    // Real syntax highlighting rather than a plain-text dump: react-syntax-highlighter's
    // Prism renderer wraps each token in a <span> with an inline style attribute whose value
    // depends on the token type (keyword, function, string, etc.). A flat text blob would
    // produce zero or one styled span; a highlighted file produces many, with several distinct
    // styles. Collect the style strings and assert there's more than one unique value.
    const styles = await mainContent.locator('span[style]').evaluateAll(
      (els) => els.map((el) => el.getAttribute('style') ?? ''),
    );
    expect(styles.length).toBeGreaterThan(5);
    const uniqueStyles = new Set(styles);
    expect(uniqueStyles.size).toBeGreaterThan(1);
  });
});
