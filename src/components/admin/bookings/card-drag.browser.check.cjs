/* eslint-disable @typescript-eslint/no-require-imports */
// P1-23 real-browser regression (LE 2026-10-29: "the card should be draggable even if where is the mouse
// is located on teh card"). Same environment as bay-controls.browser.check.cjs; never loads .env.
// Fixture day (board-browser.fixture.ts): the Wash car "Synthetic Vios" in the one Waiting lane, Wash 1 holding a car, Wash 2 empty (P1-62 A2:
// the per-type rows are gone; the Wash container's usual-for label is Wash, so a Wash car asks nothing there).
// Uses stepped real-mouse drags in a tall viewport: Playwright dragTo does not start a native drag here,
// and a drop point outside the viewport misses (ZEUS-CLAUDE-QSA, P1-22 QA). Optional: P123_SCREENSHOTS.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('ADMIN drags a board card from anywhere on its body; controls on the card keep working', { timeout: 120_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.equal(upstream.origin, process.env.P120_BROWSER_ORIGIN);
  assert.equal(upstream.username + upstream.password, '');
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  assert.ok(process.env.P120_TEST_EMAIL && process.env.P120_TEST_PASSWORD, 'Supply synthetic fixture credentials');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const shot = async (page, name) => { if (process.env.P123_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.P123_SCREENSHOTS, name + '.png') }); };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 2400 } });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.127' } });
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    const puts = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' && /\/api\/admin\/bookings\/[^/]+\/bay$/.test(new URL(request.url()).pathname)) puts.push(JSON.parse(request.postData() || '{}'));
    });
    await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Staff Email or Username').fill(process.env.P120_TEST_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Bay board', exact: true }).click();
    const waiting = page.getByRole('region', { name: 'Waiting', exact: true });
    const card = waiting.locator('article[aria-label^="ZEUS-"]').filter({ hasText: 'Synthetic Vios' });
    await card.waitFor();
    const ref = (await card.getAttribute('aria-label')) ?? '';
    assert.match(ref, /^ZEUS-/, 'a waiting Wash card');
    const bays = await page.locator('article[aria-label="Wash"] section[data-board-column]').evaluateAll((els) => els.map((el) => ({ label: el.getAttribute('aria-label'), cards: el.querySelectorAll('article').length })));
    const busyBay = bays.find((b) => b.cards > 0)?.label, emptyBay = bays.find((b) => b.cards === 0)?.label;
    assert.ok(busyBay && emptyBay, 'fixture needs a busy and an empty Wash bay: ' + JSON.stringify(bays));
    const WAITING = 'Waiting';
    const column = (label) => (label === WAITING ? waiting : page.locator('section[data-board-column][aria-label="' + label + '"]'));
    const cardIn = (label) => column(label).getByRole('article', { name: ref, exact: true });
    // Counted on window after the page's own handlers (bubble phase): a dragstart the card cancels
    // (pressed on a control) is not a drag. Cancelled ones are counted separately.
    await page.evaluate(() => {
      window.__dragStarts = 0; window.__cancelledDragStarts = 0;
      window.addEventListener('dragstart', (e) => { if (e.defaultPrevented) window.__cancelledDragStarts++; else window.__dragStarts++; });
    });
    const dragStarts = () => page.evaluate(() => window.__dragStarts);
    const centre = async (locator) => { const b = await locator.boundingBox(); assert.ok(b, 'visible'); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    // Press on a point, move in small steps to the target's centre, release. Returns mid-drag card styles.
    async function drag(from, to) {
      // A move can leave #admin-content scrolled (focus follows the moved card): put both ends on screen first.
      await to.scrollIntoViewIfNeeded(); await from.scrollIntoViewIfNeeded();
      const a = await centre(from), b = await centre(to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(a.x + 12, a.y + 12, { steps: 5 });
      const during = await page.getByRole('article', { name: ref, exact: true }).evaluate((el) => getComputedStyle(el).opacity);
      await page.mouse.move(b.x, b.y, { steps: 20 });
      await page.mouse.up();
      return during;
    }

    const body = card.getByText(/Synthetic Vehicle|·/).first();
    assert.equal(await card.getAttribute('draggable'), 'true', 'the card itself is the drag source');
    assert.equal(await body.evaluate((el) => getComputedStyle(el).cursor), 'grab', 'grab cursor over the card body');
    assert.equal(await page.getByText('Drag to bay', { exact: true }).count(), 0, 'no separate drag-only control');

    // The reference still opens the booking detail.
    await card.getByRole('button', { name: ref, exact: true }).click();
    const detail = page.getByRole('dialog');
    await detail.waitFor();
    await page.keyboard.press('Escape');
    await detail.waitFor({ state: 'detached' });

    // Pressing on the dropdown or the Move car button and moving does not start a card drag.
    const select = card.getByLabel('Move ' + ref + ' to bay');
    const moveButton = card.getByRole('button', { name: 'Move car', exact: true });
    for (const control of [select, moveButton]) {
      await drag(control, column(emptyBay));
      await page.keyboard.press('Escape');
    }
    assert.equal(await dragStarts(), 0, 'no drag starts from the dropdown or the Move car button');
    assert.equal(puts.length, 0, 'no move was sent from the dropdown or the button');
    await cardIn(WAITING).waitFor();
    assert.equal(await cardIn(WAITING).count(), 1, 'the car stayed in Waiting');
    assert.equal(await cardIn(WAITING).evaluate((el) => getComputedStyle(el).opacity), '1', 'no dragging state after pressing a control');
    await select.selectOption({ label: emptyBay });
    assert.equal(await select.inputValue() !== '', true, 'the dropdown still selects normally');
    await select.selectOption({ index: 0 }).catch(() => {});

    // A busy bay refuses the drop with no write.
    await drag(body, column(busyBay));
    await page.getByRole('status').filter({ hasText: 'This bay is busy. The car stayed where it was.' }).waitFor();
    assert.equal(puts.length, 0, 'a drop on a busy bay sends no PUT');
    // A refused drop reloads the board (it briefly empties), so wait for the card to be drawn again.
    await cardIn(WAITING).waitFor();
    assert.equal(await cardIn(WAITING).count(), 1, 'the car stays in Waiting');
    assert.equal(await cardIn(busyBay).count(), 0, 'the car is not in the busy bay');
    assert.equal(puts.length, 0, 'still no PUT after the reload');

    // Drag from the card body (the vehicle line) to the empty bay: exactly one PUT, the card moves.
    const startsBefore = await dragStarts();
    const opacity = await drag(body, column(emptyBay));
    assert.equal(await dragStarts(), startsBefore + 1, 'a press on the card body starts one drag');
    assert.ok(Number(opacity) < 1, 'the card shows a dragging state: opacity ' + opacity);
    await page.getByRole('status').filter({ hasText: 'Car moved.' }).waitFor();
    await cardIn(emptyBay).waitFor();
    assert.equal(puts.length, 1, 'one PUT for one drop');
    assert.equal(typeof puts[0].bayId, 'string', 'the PUT names the bay');
    assert.equal(Number(await page.getByRole('article', { name: ref, exact: true }).evaluate((el) => getComputedStyle(el).opacity)), 1, 'the dragging state clears after the drop');
    await shot(page, '1280-card-in-bay');

    // Drag it back to its Waiting queue: one more PUT with bayId null.
    await drag(cardIn(emptyBay).getByText(/Synthetic Vehicle|·/).first(), column(WAITING));
    await page.getByRole('status').filter({ hasText: 'Car moved.' }).waitFor();
    await cardIn(WAITING).waitFor();
    assert.equal(puts.length, 2, 'one PUT for the return');
    assert.equal(puts[1].bayId, null, 'returning to Waiting sends bayId null');
    await shot(page, '1280-card-back-in-waiting');

    const cleanDragStyle = async (locator, reason) => {
      const style = await locator.evaluate((el) => ({ opacity: getComputedStyle(el).opacity, classes: [...el.classList] }));
      assert.equal(style.opacity, '1', reason + ': opacity resets');
      for (const token of ['opacity-50', 'ring-2', 'ring-primary']) assert.equal(style.classes.includes(token), false, reason + ': no stale ' + token);
    };
    const resting = () => cardIn(WAITING);
    const restBody = () => resting().locator('p').first();
    const begin = async () => {
      const a = await centre(restBody());
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move(a.x + 14, a.y + 14, { steps: 5 });
      assert.ok(Number(await resting().evaluate((el) => getComputedStyle(el).opacity)) < 1, 'native drag has started');
    };
    // Cancellation and outside-column drops keep the original no-write behavior and remove the ring.
    await begin(); await page.keyboard.press('Escape'); await page.mouse.up();
    await page.waitForTimeout(150);
    await cleanDragStyle(resting(), 'Escape');
    await begin(); const header = await centre(page.locator('header'));
    await page.mouse.move(header.x, header.y, { steps: 20 }); await page.mouse.up();
    await page.waitForTimeout(150);
    await cleanDragStyle(resting(), 'outside drop');
    assert.equal(puts.length, 2, 'cancelled/outside drags send no PUT');
    // P1-62: there is one Waiting lane, so "a different Waiting queue" no longer exists. Dropping a waiting car back on Waiting does nothing.
    await drag(restBody(), waiting);
    await page.waitForTimeout(200);
    assert.equal(puts.length, 2, 'a drop on Waiting sends no PUT for a car that is already waiting');
    await cleanDragStyle(resting(), 'drop on Waiting');

    // F1 (P1-62: the old "bay does not take this queue" refusal is gone; the same redraw-before-dragend case is now "Place it anyway?" answered
    // Cancel): the card is redrawn, no PUT is sent, the car stays in Waiting and its appearance is clean.
    const otherKind = column('Detail 1');
    const sourceElement = await resting().elementHandle();
    await drag(restBody(), otherKind);
    const prompt = page.getByRole('dialog', { name: 'Place it anyway?' });
    await prompt.waitFor();
    await prompt.getByRole('button', { name: 'Cancel' }).click();
    await prompt.waitFor({ state: 'detached' });
    await page.waitForFunction((el) => !el.isConnected, sourceElement);
    await resting().waitFor();
    assert.equal(puts.length, 2, 'a cancelled placement sends no PUT');
    assert.equal(await resting().count(), 1, 'a cancelled placement leaves the car in Waiting');
    assert.equal(await otherKind.getByRole('article', { name: ref, exact: true }).count(), 0, 'the other bay never receives the car');
    await shot(page, '1280-place-anyway-cancelled');
    await cleanDragStyle(resting(), 'cancelled placement after redraw');

    // Keyboard/phone fallback after that rejection writes once each way and must not inherit a ring.
    await page.setViewportSize({ width: 390, height: 900 });
    await resting().getByLabel('Move ' + ref + ' to bay').selectOption({ label: emptyBay });
    await resting().getByRole('button', { name: 'Move car', exact: true }).focus();
    await page.keyboard.press('Enter'); await cardIn(emptyBay).waitFor();
    assert.equal(puts.length, 3, 'post-rejection keyboard move sends exactly one PUT');
    assert.equal(typeof puts[2].bayId, 'string');
    await cleanDragStyle(cardIn(emptyBay), 'keyboard move after rejection');
    await cardIn(emptyBay).getByLabel('Move ' + ref + ' to bay').selectOption({ index: 0 });
    await cardIn(emptyBay).getByRole('button', { name: 'Move car', exact: true }).focus();
    await page.keyboard.press('Enter'); await resting().waitFor();
    assert.equal(puts.length, 4, 'post-rejection keyboard return sends exactly one PUT');
    assert.equal(puts[3].bayId, null);
    await cleanDragStyle(resting(), 'keyboard return after rejection');
    await shot(page, '390-post-rejection-keyboard-return');

    await page.setViewportSize({ width: 1280, height: 2400 });
    const busyReload = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/board' && r.status() === 200);
    await drag(restBody(), column(busyBay));
    await page.getByRole('status').filter({ hasText: 'This bay is busy. The car stayed where it was.' }).waitFor();
    await busyReload; await resting().waitFor();
    assert.equal(puts.length, 4, 'busy rejection still sends no PUT after keyboard fallback');
    assert.equal(await cardIn(busyBay).count(), 0);
    await cleanDragStyle(resting(), 'busy rejection after redraw');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
