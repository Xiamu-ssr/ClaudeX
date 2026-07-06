import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FAKE_CLAUDE_BIN = path.join(__dirname, 'fixtures/fake-claude/fake-claude.mjs');

async function closeApp(app: ElectronApplication) {
  await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  try {
    app.process().kill('SIGKILL');
  } catch {
    // already exited — expected in the common case.
  }
}

// The real Claude Code stores sessions under encodeCwd(cwd) = cwd.replace(/\//g, '-'),
// and listSessionsInProject() looks them up by that same encoding — so the fixture
// must mirror that layout (or sessions won't be discoverable by the sidebar).
function writeSessionFile(projectsDir: string, _encodedDir: string, sessionId: string, cwd: string, content: string) {
  const dirPath = path.join(projectsDir, cwd.replace(/\//g, '-'));
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(
    path.join(dirPath, `${sessionId}.jsonl`),
    JSON.stringify({ type: 'user', message: { role: 'user', content }, cwd, uuid: 'u1' }) + '\n',
  );
}

function projectRow(page: Page, name: string) {
  return page.locator('aside').locator('div.relative', { hasText: name });
}

async function projectOrder(page: Page): Promise<string[]> {
  // Scoped to span.truncate inside div.relative to exclude the user-info section,
  // which is also div.relative but uses div.truncate (not span.truncate) for its text.
  return page.locator('aside div.relative span.truncate').evaluateAll((els) =>
    els.map((el) => el.textContent?.trim() ?? '')
  );
}

test.describe('sidebar: project menu', () => {
  let userDataDir: string;
  let projectsDir: string;
  let projectADir: string;
  let projectBDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-userdata-'));
    projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-projects-'));
    projectADir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-proj-a-'));
    projectBDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-proj-b-'));

    writeSessionFile(projectsDir, 'proj-a', 'session-1', projectADir, 'hello from a');
    // proj-a is older; proj-b is newer, so default (unpinned) order is b, a
    const olderFile = path.join(projectsDir, projectADir.replace(/\//g, '-'), 'session-1.jsonl');
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(olderFile, past, past);
    writeSessionFile(projectsDir, 'proj-b', 'session-1', projectBDir, 'hello from b');

    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, CCODEBOX_CLAUDE_BIN: FAKE_CLAUDE_BIN, CCODEBOX_PROJECTS_DIR: projectsDir },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('aside')).toContainText(path.basename(projectADir));
    await expect(page.locator('aside')).toContainText(path.basename(projectBDir));
  });

  test.afterEach(async () => {
    await closeApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectsDir, { recursive: true, force: true });
    fs.rmSync(projectADir, { recursive: true, force: true });
    fs.rmSync(projectBDir, { recursive: true, force: true });
  });

  test('pinning a project moves it to the top of the list', async () => {
    const nameA = path.basename(projectADir);
    const nameB = path.basename(projectBDir);

    expect(await projectOrder(page)).toEqual([nameB, nameA]);

    await projectRow(page, nameA).getByLabel('项目菜单').click();
    await page.getByRole('button', { name: '置顶', exact: true }).click();

    await expect.poll(() => projectOrder(page)).toEqual([nameA, nameB]);
  });

  test('renaming a project updates the displayed name', async () => {
    const nameA = path.basename(projectADir);

    await projectRow(page, nameA).getByLabel('项目菜单').click();
    await page.getByRole('button', { name: '重命名' }).click();

    const renameInput = page.locator('aside div.relative input');
    await renameInput.fill('我的项目');
    await renameInput.press('Enter');

    await expect(page.locator('aside')).toContainText('我的项目');
    await expect(page.locator('aside')).not.toContainText(nameA);
  });

  test('removing a project hides it from the sidebar', async () => {
    const nameA = path.basename(projectADir);
    const nameB = path.basename(projectBDir);

    await projectRow(page, nameA).getByLabel('项目菜单').click();
    await page.getByRole('button', { name: '移除', exact: true }).click();

    await expect(page.locator('aside')).not.toContainText(nameA);
    await expect(page.locator('aside')).toContainText(nameB);
  });
});

test.describe('chat view: session menu', () => {
  let userDataDir: string;
  let projectsDir: string;
  let repoDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-userdata-'));
    projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-projects-'));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-repo-'));
    writeSessionFile(projectsDir, 'proj', 'session-1', repoDir, '你好，这是一条测试消息');

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
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  test('removing the active session from its own menu navigates back home', async () => {
    await page.getByRole('button', { name: '你好，这是一条测试消息' }).click();
    await expect(page.getByText('你好，这是一条测试消息').first()).toBeVisible();

    await page.locator('div.flex-1.bg-main-bg button:has(svg.lucide-ellipsis)').click();
    await page.getByRole('button', { name: '移除此对话' }).click();

    await expect(page.getByPlaceholder('随心输入')).toBeVisible();
    await expect(page.getByText('你好，这是一条测试消息')).toHaveCount(0);
  });

  test('forking a historical session from its own menu opens a new session with the same history', async () => {
    await page.getByRole('button', { name: '你好，这是一条测试消息' }).click();
    await expect(page.getByText('你好，这是一条测试消息').first()).toBeVisible();

    await page.locator('div.flex-1.bg-main-bg button:has(svg.lucide-ellipsis)').click();
    await page.getByRole('button', { name: '分叉新对话' }).click();

    // Forking opens the new session in place (same 'chat' view) with the same replayed history.
    await expect(page.getByText('你好，这是一条测试消息').first()).toBeVisible();
    // Sidebar now lists two sessions under the project with the same title (original + fork).
    await expect(page.locator('aside').getByText('你好，这是一条测试消息')).toHaveCount(2);
  });

  test('fork menu item is disabled while a turn is in flight', async () => {
    await page.getByRole('button', { name: '你好，这是一条测试消息' }).click();
    await expect(page.getByText('你好，这是一条测试消息').first()).toBeVisible();

    await page.getByPlaceholder('要求后续变更').fill('another message');
    await page.getByPlaceholder('要求后续变更').press('Enter');

    await page.locator('div.flex-1.bg-main-bg button:has(svg.lucide-ellipsis)').click();
    await expect(page.getByRole('button', { name: '分叉新对话' })).toBeDisabled();

    // Let the in-flight turn resolve (fake CLI replies "fake-reply: <text>" after ~400ms) so
    // afterEach's app.close() isn't racing a still-in-flight turn.
    await expect(page.getByText('fake-reply: another message')).toBeVisible();
  });
});
