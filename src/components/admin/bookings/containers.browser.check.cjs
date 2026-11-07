/* eslint-disable @typescript-eslint/no-require-imports */
// P1-62 A2 real-browser check of the container board. Fixture: src/server/admin/board-browser.fixture.ts (loopback, synthetic, never .env).
// Env: P120_BROWSER_ORIGIN, P120_APP_ORIGIN, P120_TEST_EMAIL, P120_TEST_PASSWORD, PLAYWRIGHT_MODULE, P120_CHROME_EXECUTABLE, optional P162_SHOTS (folder).
// The check changes data (it drags, adds, renames, removes), so build a fresh database for every run.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('P1-62 container board: one Waiting, containers, one Done; place-anyway prompt; add/rename/label/move/remove; phone tabs', { timeout: 300_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  assert.ok(process.env.P120_TEST_EMAIL && process.env.P120_TEST_PASSWORD, 'Supply synthetic fixture credentials');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const retryable = ['GET', 'HEAD'].includes(request.method());
      let response;
      for (let attempt = 0; !response; attempt++) {
        try {
          response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.162' } });
        } catch (error) {
          if (!retryable || attempt === 2 || !/ECONNRESET|socket hang up/.test(error.message)) throw error;
        }
      }
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    const puts = [];
    page.on('request', (request) => { if (request.method() === 'PUT' && /\/bay$/.test(new URL(request.url()).pathname)) puts.push(JSON.parse(request.postData() || '{}')); });
    const confirms = [];
    page.on('dialog', async (dialog) => { confirms.push(dialog.message()); await dialog.accept(); });
    const shot = async (name) => { if (process.env.P162_SHOTS) await page.screenshot({ path: path.join(process.env.P162_SHOTS, name + '.png') }); };

    await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Staff Email or ID').fill(process.env.P120_TEST_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Bay board', exact: true }).click();
    await page.getByLabel('Board day').waitFor();

    const waiting = page.getByRole('region', { name: 'Waiting', exact: true });
    const done = page.getByRole('region', { name: 'Done', exact: true });
    const container = (name) => page.locator(`article[aria-label="${name}"]`);
    const bay = (name) => page.locator(`section[data-board-column][aria-label="${name}"]`);
    const car = (scope, model) => scope.locator('article[aria-label^="ZEUS-"]').filter({ hasText: model });
    await waiting.waitFor();
    const status = page.locator('#board-status');
    const settle = async () => { await page.waitForTimeout(300); await page.waitForFunction(() => !document.querySelector('#board-status')?.textContent?.match(/\.\.\.$/)); };

    // Stepped real-mouse drag (Playwright dragTo does not start a native drag here).
    async function drag(from, to) {
      await from.scrollIntoViewIfNeeded();
      const a = await from.boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + 20);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 12, a.y + 32, { steps: 5 });
      await to.scrollIntoViewIfNeeded();
      const b = await to.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40), { steps: 20 });
      await page.mouse.up();
    }

    // ---- 1. Layout at desktop: Waiting left, containers in the middle, Done right; one service tag style; page cannot scroll ----
    const box = async (l) => l.boundingBox();
    const w = await box(waiting), d = await box(done), c1 = await box(container('Wash'));
    assert.ok(w.x < c1.x && c1.x < d.x, 'Waiting, containers, Done from left to right: ' + JSON.stringify({ w: w.x, c: c1.x, d: d.x }));
    for (const name of ['Wash', 'Detailing', 'Paint', 'Express wash']) await container(name).waitFor();
    assert.equal(await page.locator('[data-board-zone="WAITING"]').count(), 1, 'one Waiting lane');
    assert.equal(await page.locator('[data-board-zone="DONE"]').count(), 1, 'one Done lane');
    assert.equal(await waiting.locator('article[aria-label^="ZEUS-"]').count(), 4, 'every waiting car is in the one Waiting lane');
    const tags = await page.locator('[data-service-tag]').evaluateAll((els) => els.map((e) => ({ text: e.textContent, cls: e.className, color: getComputedStyle(e).color, border: getComputedStyle(e).borderTopColor, bg: getComputedStyle(e).backgroundColor })));
    assert.ok(tags.some((t) => t.text === 'Wash + 2 more'), 'the mixed booking reads Wash + 2 more: ' + JSON.stringify(tags.map((t) => t.text)));
    assert.equal(new Set(tags.map((t) => t.cls)).size, 1, 'one pill style');
    assert.equal(new Set(tags.map((t) => t.color + t.border + t.bg)).size, 1, 'one colour set for every service tag (no per-kind colours)');
    const doneCard = car(done, 'Synthetic Civic');
    await doneCard.waitFor();
    const doneText = await doneCard.innerText();
    assert.match(doneText, /Finished \d{1,2}:\d{2}\s?(AM|PM|am|pm)/, 'Done shows the finish time: ' + doneText);
    assert.match(doneText, /Ana Reyes, Ben Cruz/, 'Done shows who worked');
    assert.equal(await doneCard.getByRole('button', { name: 'Move car' }).count(), 0, 'a Done card has no move controls');
    assert.equal(await page.getByText(/daily limit/i).count(), 0, 'no daily-limits panel');
    const still = async (where) => {
      const s = await page.evaluate(() => ({ scrollY: window.scrollY, height: document.scrollingElement.scrollHeight, client: document.scrollingElement.clientHeight, header: Math.round(document.querySelector('header').getBoundingClientRect().top) }));
      assert.ok(s.height <= s.client && s.scrollY === 0 && s.header >= 0, where + ': the page itself cannot scroll: ' + JSON.stringify(s));
    };
    await still('desktop at rest');
    await shot('1280-board');

    // ---- 2. Clicking a card body opens the EXISTING booking details modal ----
    const vios = car(waiting, 'Synthetic Vios');
    await vios.getByText(/Synthetic Vios/).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Booking details').waitFor({ timeout: 8000 });
    assert.equal(await dialog.evaluate((el) => el.open && el.matches(':modal')), true, 'the details open as the existing modal');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await doneCard.getByText(/Synthetic Civic/).first().click();
    await dialog.getByText('Booking details').waitFor({ timeout: 8000 });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });

    // ---- 3. Place it anyway: a labelled container asks once, never blocks; an unlabelled one never asks ----
    const prompt = page.getByRole('dialog', { name: 'Place it anyway?' });
    const before = puts.length;
    await drag(car(waiting, 'Synthetic Vios'), bay('Detail 1'));
    await prompt.waitFor();
    assert.match(await prompt.innerText(), /This car is a Wash car and Detailing is usually for Detailing and coating and Tint and PPF\. Place it anyway\?/);
    await shot('1280-place-anyway');
    await prompt.getByRole('button', { name: 'Cancel' }).click();
    await prompt.waitFor({ state: 'detached' });
    assert.equal(puts.length, before, 'Cancel moves nothing');
    assert.equal(await car(waiting, 'Synthetic Vios').count(), 1, 'the car stayed in Waiting');
    await drag(car(waiting, 'Synthetic Vios'), bay('Detail 1'));
    await prompt.waitFor();
    await prompt.getByRole('button', { name: 'Place it anyway' }).click();
    await bay('Detail 1').locator('article', { hasText: 'Synthetic Vios' }).waitFor();
    assert.equal(puts.length, before + 1, 'the confirmed placement is one write');
    assert.equal(puts.at(-1).bayId !== null, true);
    // Unlabelled container: no question.
    await drag(car(waiting, 'Synthetic City'), bay('Express 1'));
    await bay('Express 1').locator('article', { hasText: 'Synthetic City' }).waitFor();
    assert.equal(await prompt.count(), 0, 'no label, no prompt');
    // A matching label: no question either.
    // Busy bay: refused in words, nothing written.
    const writes = puts.length;
    await drag(car(waiting, 'Synthetic Xpander'), bay('Wash 1'));
    await page.locator('[data-board-notice="refusal"]').getByText('This bay is busy. The car stayed where it was.').waitFor();
    assert.equal(puts.length, writes, 'a busy bay writes nothing');
    await page.getByRole('button', { name: 'Dismiss' }).click();

    // ---- 4. Keyboard path: the move list is grouped by container; every empty bay is offered whatever the car is ----
    const mixed = car(waiting, 'Synthetic Fortuner');
    const select = mixed.getByLabel(/^Move ZEUS-.* to bay$/);
    const groups = await select.locator('optgroup').evaluateAll((els) => els.map((e) => e.label));
    assert.deepEqual(groups, ['Wash', 'Detailing', 'Paint', 'Express wash'], 'grouped by container');
    assert.equal(await select.locator('option', { hasText: 'Wash 1 · Busy' }).isDisabled(), true, 'a busy bay is listed but disabled');
    assert.equal(await select.locator('option', { hasText: 'Paint 1' }).isDisabled(), false, 'an empty bay of another kind is offered');
    await select.selectOption({ label: 'Paint 1' });
    await mixed.getByRole('button', { name: 'Move car' }).click();
    await prompt.waitFor();
    assert.match(await prompt.innerText(), /Paint is usually for Repaint/);
    await prompt.getByRole('button', { name: 'Place it anyway' }).click();
    await bay('Paint 1').locator('article', { hasText: 'Synthetic Fortuner' }).waitFor();
    assert.match(await bay('Paint 1').locator('[data-service-tag]').first().innerText(), /Wash \+ 2 more/, 'the mixed tag follows the car into the bay');
    // Back to Waiting by the same control.
    const back = bay('Paint 1').locator('article', { hasText: 'Synthetic Fortuner' });
    await back.getByLabel(/^Move ZEUS-.* to bay$/).selectOption({ label: 'Waiting' });
    await back.getByRole('button', { name: 'Move car' }).click();
    await car(waiting, 'Synthetic Fortuner').waitFor();

    // ---- 5. Finish by dragging onto Done: who worked is shown ----
    const confirmsBefore = confirms.length;
    await drag(car(container('Wash'), 'Synthetic Seltos'), done);
    await car(done, 'Synthetic Seltos').waitFor();
    assert.equal(confirms.length, confirmsBefore + 1, 'finishing asks once, in words');
    assert.match(await car(done, 'Synthetic Seltos').innerText(), /Ana Reyes/);

    // ---- 6. Containers: add, add a bay, label, rename, move a bay, remove (with the delete rules) ----
    await page.getByLabel('New container (a named group of bays)').fill('Coating room');
    await page.getByRole('button', { name: 'Add container' }).click();
    await container('Coating room').waitFor();
    await page.getByRole('status').filter({ hasText: 'Coating room added.' }).waitFor();
    // The same name again, and a bay's name, are refused in plain words.
    await page.getByLabel('New container (a named group of bays)').fill('coating ROOM');
    await page.getByRole('button', { name: 'Add container' }).click();
    await page.getByRole('alert').filter({ hasText: 'A container or bay with this name already exists.' }).waitFor();
    await page.getByLabel('New container (a named group of bays)').fill('');
    await container('Coating room').getByRole('button', { name: 'Add bay to Coating room' }).click();
    const addBay = page.getByRole('dialog', { name: /Add a/ });
    await addBay.getByLabel('Bay name').fill('Coat 1');
    await addBay.getByRole('button', { name: 'Add bay', exact: true }).click();
    await bay('Coat 1').waitFor();
    // Usually for…
    await container('Coating room').getByRole('button', { name: 'Options for Coating room' }).click();
    await page.getByRole('menuitem', { name: 'Usually for…' }).click();
    const label = page.getByRole('dialog', { name: /usually for/ });
    await label.getByLabel('Repaint').check();
    await label.getByRole('button', { name: 'Save' }).click();
    await container('Coating room').getByText('Usually for Repaint').waitFor();
    // Rename
    await container('Coating room').getByRole('button', { name: 'Options for Coating room' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const rename = page.getByRole('dialog', { name: /Rename/ });
    await rename.getByLabel('Container name').fill('Coating studio');
    await rename.getByRole('button', { name: 'Save name' }).click();
    await container('Coating studio').waitFor();
    // Remove with a bay in it: refused in words, nothing removed.
    await container('Coating studio').getByRole('button', { name: 'Options for Coating studio' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await page.getByRole('alert').filter({ hasText: 'Move or remove the bays in Coating studio first.' }).waitFor();
    // Move the bay to Paint, then remove the empty container.
    await bay('Coat 1').getByRole('button', { name: 'Options for Coat 1' }).click();
    await page.getByRole('menuitem', { name: 'Move to container' }).click();
    await page.getByLabel('Move Coat 1 to').selectOption({ label: 'Paint' });
    await page.getByRole('button', { name: 'Move bay' }).click();
    await container('Paint').locator('section[data-board-column][aria-label="Coat 1"]').waitFor();
    await container('Coating studio').getByRole('button', { name: 'Options for Coating studio' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    const removeDialog = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /Remove Coating studio/ }));
    await removeDialog.getByRole('button', { name: 'Remove container' }).click();
    await container('Coating studio').waitFor({ state: 'detached' });
    await page.getByRole('status').filter({ hasText: 'Coating studio removed.' }).waitFor();
    await still('desktop after container changes');
    await shot('1280-after-changes');

    // ---- 6b. The Bays tab follows the containers; a removed bay whose container was removed moves first, then comes back (L1) ----
    const sections = page.getByRole('group', { name: 'Bay board sections' });
    await page.getByLabel('New container (a named group of bays)').fill('Pop-up tent');
    await page.getByRole('button', { name: 'Add container' }).click();
    await container('Pop-up tent').getByRole('button', { name: 'Add bay to Pop-up tent' }).click();
    const addTent = page.getByRole('dialog', { name: /Add a/ });
    await addTent.getByLabel('Bay name').fill('Tent 1');
    await addTent.getByRole('button', { name: 'Add bay', exact: true }).click();
    await bay('Tent 1').waitFor();
    await sections.getByRole('button', { name: 'Bays', exact: true }).click();
    const tentList = page.getByRole('region', { name: 'Pop-up tent bays', exact: true });
    await tentList.getByText('Tent 1', { exact: true }).waitFor();
    assert.equal(await page.getByText('Work done in this bay').count(), 0, 'the old type question is gone');
    assert.equal(await page.getByRole('region', { name: 'Wash bays', exact: true }).count(), 0, 'no list by old type');
    await tentList.getByRole('button', { name: 'Remove Tent 1', exact: true }).click();
    await tentList.getByRole('button', { name: 'Remove bay', exact: true }).click();
    await tentList.getByRole('button', { name: 'Bring back Tent 1', exact: true }).waitFor();
    await sections.getByRole('button', { name: 'Kanban', exact: true }).click();
    await container('Pop-up tent').getByRole('button', { name: 'Options for Pop-up tent' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Remove container' }).click();
    await container('Pop-up tent').waitFor({ state: 'detached' });
    await sections.getByRole('button', { name: 'Bays', exact: true }).click();
    const orphaned = page.getByRole('region', { name: 'Bays in a removed container', exact: true });
    await orphaned.getByText('Tent 1', { exact: true }).waitFor();
    assert.equal(await orphaned.getByRole('button', { name: 'Bring back Tent 1' }).count(), 0, 'it cannot be brought back while its container is gone');
    await orphaned.getByLabel('Move Tent 1 to').selectOption({ label: 'Paint' });
    await orphaned.getByRole('button', { name: 'Move bay', exact: true }).click();
    const paintList = page.getByRole('region', { name: 'Paint bays', exact: true });
    await paintList.getByRole('button', { name: 'Bring back Tent 1', exact: true }).click();
    await paintList.getByRole('button', { name: 'Remove Tent 1', exact: true }).waitFor();
    assert.equal(await orphaned.count(), 0, 'nothing is left in a removed container');
    await shot('1280-bays-tab');
    await sections.getByRole('button', { name: 'Kanban', exact: true }).click();
    await page.getByLabel('Board day').waitFor();

    // ---- 7. Phone: three tabs, one zone at a time, 44px controls, nothing sideways ----
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const tabs = page.getByRole('group', { name: 'Board area' });
    await tabs.waitFor();
    const zonesVisible = () => page.evaluate(() => ['WAITING', 'BAYS', 'DONE'].filter((z) => { const el = document.querySelector(`[data-board-zone="${z}"]`); return el && el.getClientRects().length > 0; }));
    for (const [tab, zone] of [['Waiting', 'WAITING'], ['Bays', 'BAYS'], ['Done', 'DONE']]) {
      await tabs.getByRole('button', { name: new RegExp('^' + tab) }).click();
      assert.deepEqual(await zonesVisible(), [zone], `390px ${tab} tab shows only its zone`);
      const m = await page.evaluate(() => { const c = document.querySelector('#admin-content'); return { scroll: c.scrollWidth, client: c.clientWidth }; });
      assert.ok(m.scroll <= m.client, `390px ${tab}: no sideways scroll ${JSON.stringify(m)}`);
      await still(`390px ${tab}`);
      await shot(`390-${tab.toLowerCase()}`);
    }
    await tabs.getByRole('button', { name: /^Waiting/ }).click();
    const small = await page.evaluate(() => [...document.querySelectorAll('[data-board-zone="WAITING"] button, [data-board-zone="WAITING"] select, [aria-label="Board area"] button')].filter((el) => el.getClientRects().length && el.getBoundingClientRect().height < 43.5).map((el) => (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 40)));
    assert.deepEqual(small, [], '390px every control in Waiting and the tabs is at least 44px tall');
    await tabs.getByRole('button', { name: /^Bays/ }).click();
    const smallBays = await page.evaluate(() => [...document.querySelectorAll('[data-board-zone="BAYS"] button, [data-board-zone="BAYS"] select, [data-board-zone="BAYS"] input')].filter((el) => el.getClientRects().length && el.getBoundingClientRect().height < 43.5).map((el) => (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 40)));
    assert.deepEqual(smallBays, [], '390px every control in the containers is at least 44px tall');

    // ---- 8. A refused move shows its words inside the viewport at desktop and phone (keyboard and drag), and writes nothing ----
    const tomorrow = await page.evaluate(() => new Date(Date.now() + 8 * 3_600_000 + 86_400_000).toISOString().slice(0, 10));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByLabel('Board day').fill(tomorrow);
    const future = car(waiting, 'Synthetic Tomorrow');
    await future.waitFor();
    const futureRef = await future.getAttribute('aria-label');
    const refusal = /This booking is for .*\. It can start on that day\./;
    const visible = () => page.evaluate(() => {
      const status = document.querySelector('p[role="status"][aria-live="polite"]').getBoundingClientRect();
      const content = document.getElementById('admin-content').getBoundingClientRect();
      return status.height > 0 && status.top >= content.top - 1 && status.bottom <= Math.min(content.bottom, window.innerHeight) + 1 && status.left >= 0 && status.right <= window.innerWidth;
    });
    const refusedPut = () => page.waitForResponse((r) => r.request().method() === 'PUT' && /\/bay$/.test(new URL(r.url()).pathname));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      if (width === 390) await page.getByRole('group', { name: 'Board area' }).getByRole('button', { name: /^Waiting/ }).click();
      await future.scrollIntoViewIfNeeded();
      await future.getByLabel('Move ' + futureRef + ' to bay').selectOption({ label: 'Wash 2' });
      const reply = refusedPut();
      await future.getByRole('button', { name: 'Move car', exact: true }).focus();
      await page.keyboard.press('Enter');
      assert.equal((await reply).status(), 409, width + 'px the keyboard move is refused by the server');
      await page.getByRole('status').filter({ hasText: refusal }).waitFor();
      await page.waitForTimeout(200);
      assert.equal(await visible(), true, width + 'px the refusal is visible inside the viewport');
      await shot('refused-' + width);
      await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await future.scrollIntoViewIfNeeded();
    const reply = refusedPut();
    await drag(future, bay('Wash 2'));
    assert.equal((await reply).status(), 409, 'the drag is refused by the server too');
    await page.getByRole('status').filter({ hasText: refusal }).waitFor();
    assert.equal(await car(waiting, 'Synthetic Tomorrow').count(), 1, 'the car stayed in Waiting');

    assert.deepEqual(errors, []);
    void status; void settle;
  } finally {
    await browser.close();
  }
});
