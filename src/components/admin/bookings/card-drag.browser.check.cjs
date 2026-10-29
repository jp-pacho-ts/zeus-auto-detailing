/* eslint-disable @typescript-eslint/no-require-imports */
// P1-23 real-browser regression (LE 2026-10-29: "the card should be draggable even if where is the mouse
// is located on teh card"). Same environment as bay-controls.browser.check.cjs; never loads .env.
// Fixture day: a car waiting in "Waiting · Wash", one Wash bay holding a car and one empty Wash bay.
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
    await page.getByLabel('Staff Email or ID').fill(process.env.P120_TEST_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    const washRow = page.getByRole('region', { name: 'Wash row' });
    const waiting = washRow.getByRole('region', { name: 'Waiting · Wash', exact: true });
    const card = waiting.locator('article').first();
    await card.waitFor();
    const ref = (await card.getAttribute('aria-label')) ?? '';
    assert.match(ref, /^ZEUS-/, 'a waiting Wash card');
    const bays = await washRow.locator('section[aria-label^="Wash Bay"]').evaluateAll((els) => els.map((el) => ({ label: el.getAttribute('aria-label'), cards: el.querySelectorAll('article').length })));
    const busyBay = bays.find((b) => b.cards > 0)?.label, emptyBay = bays.find((b) => b.cards === 0)?.label;
    assert.ok(busyBay && emptyBay, 'fixture needs a busy and an empty Wash bay: ' + JSON.stringify(bays));
    const column = (label) => washRow.getByRole('region', { name: label, exact: true });
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
    await cardIn('Waiting · Wash').waitFor();
    assert.equal(await cardIn('Waiting · Wash').count(), 1, 'the car stayed in Waiting');
    assert.equal(await cardIn('Waiting · Wash').evaluate((el) => getComputedStyle(el).opacity), '1', 'no dragging state after pressing a control');
    await select.selectOption({ label: emptyBay });
    assert.equal(await select.inputValue() !== '', true, 'the dropdown still selects normally');
    await select.selectOption({ index: 0 }).catch(() => {});

    // A busy bay refuses the drop with no write.
    await drag(body, column(busyBay));
    await page.getByRole('status').filter({ hasText: 'This bay is busy. The car stayed in its column.' }).waitFor();
    assert.equal(puts.length, 0, 'a drop on a busy bay sends no PUT');
    // A refused drop reloads the board (it briefly empties), so wait for the card to be drawn again.
    await cardIn('Waiting · Wash').waitFor();
    assert.equal(await cardIn('Waiting · Wash').count(), 1, 'the car stays in Waiting');
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
    await drag(cardIn(emptyBay).getByText(/Synthetic Vehicle|·/).first(), column('Waiting · Wash'));
    await page.getByRole('status').filter({ hasText: 'Car moved.' }).waitFor();
    await cardIn('Waiting · Wash').waitFor();
    assert.equal(puts.length, 2, 'one PUT for the return');
    assert.equal(puts[1].bayId, null, 'returning to Waiting sends bayId null');
    await shot(page, '1280-card-back-in-waiting');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
