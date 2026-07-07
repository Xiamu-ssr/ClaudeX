import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FAKE_CLAUDE_BIN = path.join(__dirname, 'fixtures/fake-claude/fake-claude.mjs');

// Width constants must stay in sync with src/renderer/components/RightPanel.tsx — these mirror
// the renderer's source of truth so a constants drift would fail the test loudly here rather
// than silently mis-clamping in production.
const STORAGE_KEY = 'ccodebox:rightPanelWidth';
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;

// app.close() can hang after a child process (ClaudeSession or a terminal pty) was spawned
// during the test — see right-panel.spec.ts's afterEach for the same observed CDP/debugger
// teardown race. Race against a short timeout and force-kill as a fallback.
async function closeApp(app: ElectronApplication) {
  await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  try {
    app.process().kill('SIGKILL');
  } catch {
    // already exited — expected in the common case.
  }
}

// Open the right panel via the toolbar toggle (same selector the existing right-panel.spec.ts
// tests use) and wait for the panel's <aside> to be present. The right panel is the <aside>
// that contains the resize handle — the Sidebar also renders an <aside>, so we anchor on the
// handle rather than a bare `aside` selector to stay unambiguous.
async function openRightPanel(page: Page) {
  await page.locator('main button:has(svg.lucide-panel-right-open)').click();
  await expect(page.locator('aside:has([data-testid="right-panel-resize-handle"])')).toBeVisible();
}

test.describe('right panel: freeform resize', () => {
  let userDataDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccodebox-test-resize-userdata-'));
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

  test('dragging the resize handle left widens the panel and persists the new width', async () => {
    await openRightPanel(page);

    const aside = page.locator('aside:has([data-testid="right-panel-resize-handle"])');
    const handle = page.locator('[data-testid="right-panel-resize-handle"]');

    const initialBox = await aside.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialWidth = initialBox!.width;
    // Fresh userDataDir → empty localStorage → the 420px default. Box-sizing is border-box
    // (see src/renderer/index.css), so boundingBox reports exactly the inline `width` value.
    expect(initialWidth).toBeCloseTo(DEFAULT_WIDTH, 0);

    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    const handleX = handleBox!.x + handleBox!.width / 2;
    const handleY = handleBox!.y + handleBox!.height / 2;

    // Drag the handle LEFT by 60px. The panel is anchored to the window's right edge, so its
    // left edge moving leftward must widen it (next = startWidth - (clientX - startX)).
    const dragLeft = 60;
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX - dragLeft, handleY, { steps: 6 });
    await page.mouse.up();

    const finalBox = await aside.boundingBox();
    expect(finalBox).not.toBeNull();
    const finalWidth = finalBox!.width;
    // Direction: dragging left must widen.
    expect(finalWidth).toBeGreaterThan(initialWidth);
    // Magnitude: 420 + 60 = 480, well within [280, 720] so no clamp interferes.
    expect(finalWidth - initialWidth).toBeGreaterThan(dragLeft - 20);

    // The width must be written to localStorage on drag end (not during the drag).
    const persisted = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(persisted).not.toBeNull();
    expect(parseInt(persisted!, 10)).toBeGreaterThan(Math.round(initialWidth));
  });

  test('dragging the resize handle right narrows the panel (sign convention check)', async () => {
    await openRightPanel(page);

    const aside = page.locator('aside:has([data-testid="right-panel-resize-handle"])');
    const handle = page.locator('[data-testid="right-panel-resize-handle"]');

    const initialBox = await aside.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialWidth = initialBox!.width;
    expect(initialWidth).toBeCloseTo(DEFAULT_WIDTH, 0);

    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    const handleX = handleBox!.x + handleBox!.width / 2;
    const handleY = handleBox!.y + handleBox!.height / 2;

    // Drag the handle RIGHT by 50px → panel narrows by 50px (420 - 50 = 370, still > 280 min).
    const dragRight = 50;
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX + dragRight, handleY, { steps: 5 });
    await page.mouse.up();

    const finalBox = await aside.boundingBox();
    expect(finalBox).not.toBeNull();
    const finalWidth = finalBox!.width;
    // Direction: dragging right must narrow.
    expect(finalWidth).toBeLessThan(initialWidth);
    expect(initialWidth - finalWidth).toBeGreaterThan(dragRight - 20);

    const persisted = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(persisted).not.toBeNull();
    expect(parseInt(persisted!, 10)).toBeLessThan(Math.round(initialWidth));
  });

  test('dragging far left clamps to MAX and the clamped width is restored across a restart', async () => {
    await openRightPanel(page);

    const aside = page.locator('aside:has([data-testid="right-panel-resize-handle"])');
    const handle = page.locator('[data-testid="right-panel-resize-handle"]');
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    const handleX = handleBox!.x + handleBox!.width / 2;
    const handleY = handleBox!.y + handleBox!.height / 2;

    // Drag the handle left by 400px — far enough that 420 + 400 = 820 exceeds MAX (720), so
    // the clamp in the drag math is what we are exercising here, not just the sign.
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX - 400, handleY, { steps: 8 });
    await page.mouse.up();

    const clampedBox = await aside.boundingBox();
    expect(clampedBox).not.toBeNull();
    expect(clampedBox!.width).toBeCloseTo(MAX_WIDTH, 0);

    const persisted = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(persisted).toBe(String(MAX_WIDTH));

    // Persistence is across app *restarts* (localStorage lives in userDataDir), so relaunch
    // with the SAME userDataDir and confirm the clamped width is read back on mount.
    await closeApp(app);
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, CCODEBOX_CLAUDE_BIN: FAKE_CLAUDE_BIN },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await openRightPanel(page);

    const restoredBox = await page
      .locator('aside:has([data-testid="right-panel-resize-handle"])')
      .boundingBox();
    expect(restoredBox).not.toBeNull();
    expect(restoredBox!.width).toBeCloseTo(MAX_WIDTH, 0);
  });

  test('a stored out-of-range width is clamped back into range on mount', async () => {
    // MAX edge: seed an over-max stored value before the panel is mounted, then open the
    // panel and confirm the lazy useState init clamps it down rather than honouring it.
    await page.evaluate(
      ({ k, v }) => localStorage.setItem(k, v),
      { k: STORAGE_KEY, v: String(MAX_WIDTH + 500) },
    );
    await openRightPanel(page);
    const maxBox = await page
      .locator('aside:has([data-testid="right-panel-resize-handle"])')
      .boundingBox();
    expect(maxBox).not.toBeNull();
    expect(maxBox!.width).toBeCloseTo(MAX_WIDTH, 0);

    // MIN edge: unmount the panel (App.tsx conditionally renders <RightPanel/> on
    // rightPanelOpen, so toggling it closed/open remounts it — the lazy useState init re-runs
    // and re-reads localStorage on the fresh mount), seed an under-min value, and confirm
    // it clamps up. Using the panel's own unmount/remount avoids a page reload, which no
    // existing test relies on and which could race the main<->renderer IPC re-handshake.
    await page.locator('main button:has(svg.lucide-panel-right-open)').click();
    await expect(page.locator('[data-testid="right-panel-resize-handle"]')).toHaveCount(0);
    await page.evaluate(
      ({ k, v }) => localStorage.setItem(k, v),
      { k: STORAGE_KEY, v: String(MIN_WIDTH - 500) },
    );
    await openRightPanel(page);
    const minBox = await page
      .locator('aside:has([data-testid="right-panel-resize-handle"])')
      .boundingBox();
    expect(minBox).not.toBeNull();
    expect(minBox!.width).toBeCloseTo(MIN_WIDTH, 0);
  });
});
