/* eslint-disable @typescript-eslint/no-require-imports */
// P1-34 real-browser check: on the Bay board a car can be finished by dropping it on
// Done (or choosing "Done (finish)" in its move control), after a plain-words confirm. Fixture as in
// board-browser.fixture.ts (P1-62 A2): today has a car in Wash 1, waiting Wash cars Vios, City and Fortuner, empty bays in the Wash container, and one car
// already in Done. The per-type rows are gone: one Waiting lane, one Done lane, and below lg three tabs (Waiting, Bays, Done) instead of the column picker. P134_WIDTH
// (default 1280) picks the viewport: 1280 drags with the mouse, 390 uses the keyboard path only.
// Never loads .env. Optional P134_SHOTS: a screenshot folder.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const confirmText = (ref) => `Finish ${ref}? All its services will be marked done and the booking completed. A finished car can't be moved back.`;

test('the Bay board: a car is finished by dropping it on Done, or from its move control, after a confirm', { timeout: 240_000 }, async () => {
  const width = Number(process.env.P134_WIDTH || 1280);
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const shot = async (page, name) => { if (process.env.P134_SHOTS) await page.screenshot({ path: path.join(process.env.P134_SHOTS, name + '.png'), fullPage: true }); };
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width, height: width >= 1000 ? 2400 : 900 } });
    let abortFinish = false;
    await context.route('**/*', async (route) => {
      const request = route.request(), u = request.url();
      if (!u.startsWith(origin + '/')) return route.abort();
      if (abortFinish && request.method() === 'POST' && /\/finish$/.test(new URL(u).pathname)) return route.abort();
      const retryable = ['GET', 'HEAD'].includes(request.method());
      let response;
      for (let attempt = 0; !response; attempt++) {
        try {
          response = await route.fetch({ url: u.replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.134' } });
        } catch (error) {
          if (!retryable || attempt === 2 || !/ECONNRESET|socket hang up/.test(error.message)) throw error;
        }
      }
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const finishes = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /\/finish$/.test(new URL(r.url()).pathname)) finishes.push(JSON.parse(r.postData() || '{}')); });
    let answer = true; const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await (answer ? d.accept() : d.dismiss()); });

    await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Staff Email or ID').fill(process.env.P120_TEST_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
    const menu = page.locator('button[aria-controls=admin-nav]');
    if (await menu.isVisible()) await menu.click();
    const nav = page.getByRole('navigation', { name: 'Shop Operations Navigation' });
    await nav.getByRole('button', { name: 'Bay board', exact: true }).click();
    await page.getByRole('heading', { name: 'Bay board', exact: true }).waitFor();
    await page.getByLabel('Board day').waitFor();
    assert.equal(await page.getByRole('group', { name: 'Bay board sections' }).count(), 1);
    await shot(page, `p134-board-${width}`);

    // Below lg only one zone is shown: choose it with the tab (the desktop shows all three).
    const show = async (zone) => {
      if (width >= 1024) return;
      await page.getByRole('group', { name: 'Board area' }).getByRole('button', { name: new RegExp('^' + zone) }).click();
    };
    const waitingCol = page.getByRole('region', { name: 'Waiting', exact: true });
    const washCar = (model) => waitingCol.locator('article[aria-label^="ZEUS-"]').filter({ hasText: model });
    await page.locator('article[aria-label="Wash"] section[data-board-column] article').first().waitFor({ state: 'attached' });
    const bays = await page.evaluate(() => [...document.querySelectorAll('article[aria-label="Wash"] section[data-board-column]')].map((el) => ({ label: el.getAttribute('aria-label'), cards: el.querySelectorAll('article').length })));
    const busyBay = bays.find((b) => b.cards > 0).label, emptyBay = bays.find((b) => b.cards === 0).label;
    const col = (label) => page.locator('section[data-board-column][aria-label="' + label + '"]');
    const doneCol = page.getByRole('region', { name: 'Done', exact: true });
    const doneCount = async () => doneCol.locator('article').count();
    const done0 = await doneCount(); // the fixture already has one finished car
    const centre = async (l) => { const b = await l.boundingBox(); assert.ok(b); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const dragTo = async (from, to) => {
      await to.scrollIntoViewIfNeeded(); await from.scrollIntoViewIfNeeded();
      const a = await centre(from), b = await centre(to);
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move(a.x + 12, a.y + 12, { steps: 5 });
      await page.mouse.move(b.x, b.y, { steps: 20 });
      await page.mouse.up();
    };
    const note = page.getByRole('status');

    // ---- 1. A Waiting car has no bay: no "Done (finish)" choice, and a drop on Done is refused visibly ----
    await show('Waiting');
    const waiting = washCar('Synthetic Vios');
    await waiting.waitFor();
    const wref = await waiting.getAttribute('aria-label');
    assert.equal(await waiting.getByLabel('Move ' + wref + ' to bay').locator('option', { hasText: 'Done (finish)' }).count(), 0, 'a Waiting car cannot be finished');
    if (width >= 1000) {
      await dragTo(waiting.getByText(/Synthetic Vehicle|·/).first(), doneCol);
      await note.filter({ hasText: 'Move this car into a bay before finishing it.' }).waitFor();
      assert.equal(finishes.length, 0, 'nothing was sent for a Waiting car');
      assert.equal(await doneCount(), done0);
    }

    // ---- 2. A car in a bay: drop on Done (desktop). Cancel changes nothing, OK finishes it ----
    if (width >= 1000) {
      const busy = col(busyBay).locator('article').first();
      const bref = await busy.getAttribute('aria-label');
      answer = false;
      await dragTo(busy.getByText(/Synthetic Vehicle|·/).first(), doneCol);
      await page.waitForFunction(() => true);
      for (let i = 0; i < 30 && !dialogs.length; i++) await page.waitForTimeout(100);
      assert.equal(dialogs.at(-1), confirmText(bref), 'the confirm says what will happen, in plain words');
      assert.equal(finishes.length, 0, 'Cancel sends nothing');
      assert.equal(await col(busyBay).getByRole('article', { name: bref, exact: true }).count(), 1, 'Cancel leaves the car in its bay');
      assert.equal(await doneCount(), done0);
      answer = true;
      await dragTo(col(busyBay).getByRole('article', { name: bref, exact: true }).getByText(/Synthetic Vehicle|·/).first(), doneCol);
      await doneCol.getByRole('article', { name: bref, exact: true }).waitFor({ timeout: 15_000 });
      assert.equal(finishes.length, 1);
      assert.equal(typeof finishes[0].expectedRevision, 'number');
      await note.filter({ hasText: 'Car finished.' }).waitFor();
      assert.equal(await col(busyBay).getByRole('article', { name: bref, exact: true }).count(), 0, 'the bay is free');
      await shot(page, 'p134-finished-1280');
      // Done is read-only.
      const doneCard = doneCol.getByRole('article', { name: bref, exact: true });
      assert.notEqual(await doneCard.getAttribute('draggable'), 'true', 'a finished car cannot be dragged out');
      assert.equal(await doneCard.getByRole('combobox').count(), 0, 'no move control on a finished car');
    }

    // ---- 3. The keyboard path: seat a Waiting car, then choose "Done (finish)" in its move control ----
    await show('Waiting');
    const w2 = washCar('Synthetic City');
    const ref2 = await w2.getAttribute('aria-label');
    await w2.getByLabel('Move ' + ref2 + ' to bay').selectOption({ label: emptyBay });
    await w2.getByRole('button', { name: 'Move car', exact: true }).click();
    await show('Bays');
    const seated = col(emptyBay).getByRole('article', { name: ref2, exact: true });
    await seated.waitFor();
    const select = seated.getByLabel('Move ' + ref2 + ' to bay');
    assert.equal(await select.locator('option', { hasText: 'Done (finish)' }).count(), 1, 'a car in a bay can be finished from its move control');
    await select.focus();
    await select.selectOption({ label: 'Done (finish)' });
    answer = false;
    const before = dialogs.length;
    await page.keyboard.press('Tab');
    await seated.getByRole('button', { name: 'Move car', exact: true }).focus();
    await page.keyboard.press('Enter');
    for (let i = 0; i < 30 && dialogs.length === before; i++) await page.waitForTimeout(100);
    assert.equal(dialogs.at(-1), confirmText(ref2));
    assert.equal(await col(emptyBay).getByRole('article', { name: ref2, exact: true }).count(), 1, 'Cancel from the keyboard changes nothing');
    answer = true;
    const sent = finishes.length;
    await seated.getByLabel('Move ' + ref2 + ' to bay').selectOption({ label: 'Done (finish)' });
    await seated.getByRole('button', { name: 'Move car', exact: true }).focus();
    await page.keyboard.press('Enter');
    // Codex F1 (P1-34): the test must NOT switch columns itself after submitting (it used to call show('Done · Wash') here, which
    // made the target visible and hid the defect). The board has to reveal the Done column on its own: at 390 px only the picked
    // column is shown, so a finish that leaves another column picked puts the result in a display:none column and focus on BODY.
    await doneCol.getByRole('article', { name: ref2, exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(finishes.length, sent + 1);
    assert.equal(await doneCol.isVisible(), true, 'the Done column is revealed after a keyboard finish, without any further selection');
    const doneBtn = doneCol.getByRole('article', { name: ref2, exact: true }).getByRole('button', { name: ref2, exact: true });
    assert.equal(await doneBtn.isVisible(), true, 'the finished card is visible');
    const focused = await page.evaluate(() => ({ id: document.activeElement?.id || '', tag: document.activeElement?.tagName || '' }));
    assert.notEqual(focused.tag, 'BODY', 'focus is not lost to BODY after a keyboard finish');
    assert.equal(focused.id, await doneBtn.getAttribute('id'), 'focus lands on the finished card');
    await shot(page, `p134-finished-keyboard-${width}`);

    // ---- 4. An uncertain finish locks the board (P1-25): no further moves or finishes until a good reload ----
    await show('Waiting');
    const w3 = washCar('Synthetic Fortuner');
    const ref3 = await w3.getAttribute('aria-label');
    await w3.getByLabel('Move ' + ref3 + ' to bay').selectOption({ label: emptyBay });
    await w3.getByRole('button', { name: 'Move car', exact: true }).click();
    await show('Bays');
    const seated3 = col(emptyBay).getByRole('article', { name: ref3, exact: true });
    await seated3.waitFor();
    abortFinish = true;
    await seated3.getByLabel('Move ' + ref3 + ' to bay').selectOption({ label: 'Done (finish)' });
    await seated3.getByRole('button', { name: 'Move car', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'outcome is uncertain' }).waitFor();
    assert.equal(await seated3.getByRole('button', { name: 'Move car', exact: true }).isDisabled(), true, 'locked after an uncertain finish');
    assert.notEqual(await seated3.getAttribute('draggable'), 'true');

    assert.deepEqual(errors, [], 'no page error');
    await page.goto('about:blank'); // stop the page's own requests before the routes go
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  } finally {
    await browser.close();
  }
});
