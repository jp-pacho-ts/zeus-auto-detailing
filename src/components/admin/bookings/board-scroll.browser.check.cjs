/* eslint-disable @typescript-eslint/no-require-imports */
// P1-25 real-browser regression: sideways-scrolling board rows (768/1024/1280/1440) and 390 picker,
// edge fades + header arrows with focus transfer, stepped real-mouse edge auto-scroll + drop on an
// off-screen column, reload scroll preservation (no board jump), shorter cards (~1/3 shorter, 44px
// targets, 200% zoom), and M1 refusal message visibility inside the viewport at 1440x900 and 390x844.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const manila = (offset) => new Date(Date.now() + 8 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const dayLabel = (day) => new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'));

test('P1-25: rows scroll sideways on one line from md, edge auto-scroll drops on off-screen bays, reloads preserve scroll, cards are shorter, and refusal messages stay in the viewport', { timeout: 180_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.equal(upstream.origin, process.env.P120_BROWSER_ORIGIN);
  assert.equal(upstream.username + upstream.password, '');
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  assert.ok(process.env.P120_TEST_EMAIL && process.env.P120_TEST_PASSWORD, 'Supply synthetic fixture credentials');
  const outDir = process.env.P125_EVIDENCE_DIR || process.env.P122_LAYOUT_SCREENSHOTS || '';
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const shot = async (page, name) => {
    if (outDir) await page.screenshot({ path: path.join(outDir, name + '.png') });
  };

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}),
  });
  const createdBays = [];
  let page;
  const summary = {
    cardHeights: {},
    widths: {},
    edgeAutoScroll: {},
    reloadPreservation: {},
    refusalVisibility: {},
  };

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const retryable = ['GET', 'HEAD'].includes(request.method());
      let response;
      for (let attempt = 0; !response; attempt++) {
        try {
          response = await route.fetch({
            url: request.url().replace(origin, upstream.origin),
            headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.125' },
          });
        } catch (error) {
          if (!retryable || attempt === 2 || !/ECONNRESET|socket hang up/.test(error.message)) throw error;
        }
      }
      await route.fulfill({ response });
    });

    page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const puts = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' && /\/api\/admin\/bookings\/[^/]+\/bay$/.test(new URL(request.url()).pathname)) {
        puts.push(JSON.parse(request.postData() || '{}'));
      }
    });

    await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Staff Email or ID').fill(process.env.P120_TEST_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Bay board', exact: true }).click();
    await page.getByLabel('Board day').waitFor();

    const washRow = page.getByRole('region', { name: 'Wash row' });
    const waitingWash = washRow.getByRole('region', { name: 'Waiting · Wash', exact: true });
    const firstCard = waitingWash.locator('article').first();
    await firstCard.waitFor();
    const ref = (await firstCard.getAttribute('aria-label')) ?? '';
    assert.match(ref, /^ZEUS-/, 'waiting Wash card present');

    // ---- 1. Shorter cards (~1/3 shorter vs 382px baseline), 44px targets, and 200% zoom ----
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      const cardLoc = waitingWash.getByRole('article', { name: ref, exact: true });
      const box = await cardLoc.boundingBox();
      assert.ok(box, width + 'px waiting card visible');
      const refBtnBox = await cardLoc.getByRole('button', { name: ref, exact: true }).boundingBox();
      const selectBox = await cardLoc.getByLabel('Move ' + ref + ' to bay').boundingBox();
      const moveBtnBox = await cardLoc.getByRole('button', { name: 'Move car', exact: true }).boundingBox();
      assert.ok(refBtnBox.height >= 44, width + 'px reference button >= 44px: ' + refBtnBox.height);
      assert.ok(selectBox.height >= 44, width + 'px bay select >= 44px: ' + selectBox.height);
      assert.ok(moveBtnBox.height >= 44, width + 'px Move car button >= 44px: ' + moveBtnBox.height);
      assert.ok(box.height <= 265, width + 'px ADMIN card is ~1/3 shorter than 382px baseline: ' + Math.round(box.height));
      summary.cardHeights[width] = {
        beforeBaselinePx: 382,
        afterPx: Math.round(box.height),
        reductionRatio: +(1 - box.height / 382).toFixed(3),
        targetsPx: {
          referenceButton: Math.round(refBtnBox.height),
          baySelect: Math.round(selectBox.height),
          moveCarButton: Math.round(moveBtnBox.height),
        },
      };
      await shot(page, `p125-card-after-${width}`);

      // 200% text zoom check
      const zoomCheck = await page.evaluate(() => {
        const root = document.documentElement;
        const prev = root.style.fontSize;
        root.style.fontSize = '200%';
        const docScroll = document.scrollingElement.scrollWidth;
        const docClient = document.scrollingElement.clientWidth;
        root.style.fontSize = prev;
        return { docScroll, docClient };
      });
      assert.ok(zoomCheck.docScroll <= zoomCheck.docClient, width + 'px no document horizontal overflow at 200% zoom');
    }

    // ---- 2. Add synthetic Wash bays so Wash row has 7 bays (9 columns total) ----
    // Clean up any leftover P125 Wash Bay from an interrupted run first
    await page.evaluate(async () => {
      const result = await (await fetch('/api/admin/bays')).json();
      for (const bay of result.data || []) {
        if (bay.isActive && /^P125 Wash Bay /.test(bay.name)) {
          await fetch('/api/admin/bays/' + bay.id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedUpdatedAt: bay.updatedAt, isActive: false }),
          });
        }
      }
    });
    const stamp = Date.now();
    for (let i = 1; i <= 5; i++) {
      const bayName = `P125 Wash Bay ${i} ${stamp}`;
      const created = await page.evaluate(async (name) => {
        const current = await (await fetch('/api/admin/bays')).json();
        const sortOrder = (current.data || []).reduce((m, b) => Math.max(m, b.sortOrder), 0) + 1;
        const res = await fetch('/api/admin/bays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, bayType: 'WASH', sortOrder }),
        });
        const body = await res.json();
        return { status: res.status, bay: body.data };
      }, bayName);
      if (created.bay?.name) createdBays.push(created.bay.name);
      assert.equal(created.status, 200, 'created synthetic Wash bay ' + i);
    }
    const lastAddedBay = createdBays[createdBays.length - 1];

    await page.setViewportSize({ width: 1280, height: 900 });
    const refreshDone = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/board' && r.status() === 200);
    await page.getByRole('button', { name: 'Refresh board', exact: true }).click();
    await refreshDone;
    await washRow.getByRole('region', { name: lastAddedBay, exact: true }).waitFor();

    // ---- 3. Multi-width layout, single-line scroller, cues, and phone picker (768, 1024, 1280, 1440, 390) ----
    for (const width of [768, 1024, 1280, 1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('[data-board-row-scroll="WASH"]').evaluate((el) => { el.scrollLeft = 0; });
      await page.locator('#admin-content').evaluate((el) => { el.scrollTop = 0; });
      await page.waitForTimeout(200);

      const state = await page.evaluate(() => {
        const doc = document.scrollingElement;
        const content = document.getElementById('admin-content');
        const washSc = document.querySelector('[data-board-row-scroll="WASH"]');
        const washWrap = document.querySelector('[data-board-row-wrap="WASH"]');
        const leftFade = washWrap.querySelector('[data-board-fade="left"]');
        const rightFade = washWrap.querySelector('[data-board-fade="right"]');
        const arrows = document.querySelector('[data-board-arrows="WASH"]');
        const prevBtn = document.querySelector('button[aria-label="Show earlier Wash columns"]');
        const nextBtn = document.querySelector('button[aria-label="Show more Wash columns"]');
        const paintArrows = document.querySelector('[data-board-arrows="PAINT"]');
        const washCols = [...washSc.querySelectorAll(':scope > section[data-board-column]')]
          .filter((c) => c.offsetParent !== null)
          .map((c) => {
            const r = c.getBoundingClientRect();
            return { label: c.getAttribute('aria-label'), top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) };
          });
        return {
          docScrollH: doc.scrollHeight,
          docClientH: doc.clientHeight,
          docScrollW: doc.scrollWidth,
          docClientW: doc.clientWidth,
          contentScrollW: content.scrollWidth,
          contentClientW: content.clientWidth,
          washDisplay: getComputedStyle(washSc).display,
          washScrollW: washSc.scrollWidth,
          washClientW: washSc.clientWidth,
          scrollbarWidth: getComputedStyle(washSc).scrollbarWidth,
          leftFadeOpacity: getComputedStyle(leftFade).opacity,
          rightFadeOpacity: getComputedStyle(rightFade).opacity,
          leftFadeDisplay: getComputedStyle(leftFade).display,
          arrowsDisplay: getComputedStyle(arrows).display,
          prevDisabled: prevBtn.disabled,
          nextDisabled: nextBtn.disabled,
          paintArrowsDisplay: getComputedStyle(paintArrows).display,
          pickerVisible: document.querySelector('select[aria-label="Wash board column"]').offsetParent !== null,
          washCols,
        };
      });

      assert.ok(state.docScrollH <= state.docClientH, width + 'px document does not scroll vertically');
      assert.ok(state.docScrollW <= state.docClientW, width + 'px document does not scroll horizontally');
      assert.ok(state.contentScrollW <= state.contentClientW, width + 'px #admin-content does not scroll horizontally');

      if (width >= 768) {
        assert.equal(state.washDisplay, 'flex', width + 'px Wash scroller is flex');
        assert.equal(state.scrollbarWidth, 'thin', width + 'px slim scrollbar');
        assert.equal(state.washCols.length, 9, width + 'px all 9 Wash columns rendered in row');
        const tops = state.washCols.map((c) => c.top);
        const heights = state.washCols.map((c) => c.height);
        assert.ok(Math.max(...tops) - Math.min(...tops) <= 1, width + 'px all 9 Wash columns sit on one horizontal line');
        assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, width + 'px all 9 Wash columns share equal height');
        for (let i = 1; i < state.washCols.length; i++) {
          assert.ok(state.washCols[i].left > state.washCols[i - 1].left, width + 'px columns progress left to right');
          assert.ok(Math.abs(state.washCols[i].width - 240) <= 2, width + 'px fixed 240px (w-60) column width');
        }
        assert.ok(state.washScrollW > state.washClientW + 400, width + 'px Wash row overflows horizontally');
        assert.equal(state.leftFadeOpacity, '0', width + 'px left fade hidden at start');
        assert.equal(state.rightFadeOpacity, '1', width + 'px right fade visible when more columns to the right');
        assert.equal(state.arrowsDisplay, 'flex', width + 'px Wash header arrows visible');
        assert.equal(state.prevDisabled, true, width + 'px earlier arrow disabled at left end');
        assert.equal(state.nextDisabled, false, width + 'px more arrow enabled when overflowing right');
        if (width >= 1280) {
          assert.equal(state.paintArrowsDisplay, 'none', width + 'px non-overflowing Paint row hides arrows');
        }
      } else {
        assert.equal(state.pickerVisible, true, '390px phone column picker visible');
        assert.equal(state.washCols.length, 1, '390px phone shows one active column per row');
        assert.equal(state.arrowsDisplay, 'none', '390px phone hides header scroll arrows');
        assert.equal(state.leftFadeDisplay, 'none', '390px phone hides edge fades');
      }
      summary.widths[width] = state;
      await shot(page, `p125-layout-${width}`);
    }

    // ---- 4. Header arrow stepping, focus transfer when disabled at end, and keyboard Tab reach ----
    await page.setViewportSize({ width: 1280, height: 900 });
    const washSc = page.locator('[data-board-row-scroll="WASH"]');
    await washSc.evaluate((el) => { el.scrollLeft = 0; });
    await page.waitForTimeout(150);

    const prevArrow = page.getByRole('button', { name: 'Show earlier Wash columns', exact: true });
    const nextArrow = page.getByRole('button', { name: 'Show more Wash columns', exact: true });
    await nextArrow.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(450);
    const afterOneStep = await washSc.evaluate((el) => Math.round(el.scrollLeft));
    assert.ok(afterOneStep >= 200 && afterOneStep <= 300, 'one arrow press scrolls ~252px: ' + afterOneStep);
    assert.equal(await prevArrow.isDisabled(), false, 'left arrow enabled after stepping right');

    // Step all the way to the right end while nextArrow has focus: focus must move to prevArrow when nextArrow disables.
    await nextArrow.focus();
    for (let i = 0; i < 10; i++) {
      if (await nextArrow.isDisabled()) break;
      await page.keyboard.press('Enter');
      await page.waitForTimeout(350);
    }
    assert.equal(await nextArrow.isDisabled(), true, 'right arrow disabled at right end');
    assert.equal(
      await prevArrow.evaluate((el) => document.activeElement === el),
      true,
      'focus transfers to Show earlier Wash columns when Show more Wash columns becomes disabled',
    );

    // Focusing the last bay's menu button keeps it clear of the 48px fade (scroll-px-12).
    const lastBayMenu = washRow.getByRole('button', { name: 'Options for ' + lastAddedBay, exact: true });
    await washSc.evaluate((el) => { el.scrollLeft = 200; });
    await page.waitForTimeout(100);
    await lastBayMenu.focus();
    await page.waitForTimeout(150);
    const focusClearance = await page.evaluate((bayName) => {
      const sc = document.querySelector('[data-board-row-scroll="WASH"]').getBoundingClientRect();
      const btn = document.querySelector(`button[aria-label="Options for ${bayName}"]`).getBoundingClientRect();
      return { btnLeft: Math.round(btn.left), btnRight: Math.round(btn.right), scLeft: Math.round(sc.left), scRight: Math.round(sc.right) };
    }, lastAddedBay);
    assert.ok(focusClearance.btnRight <= focusClearance.scRight, 'focused control in last bay is visible inside the scroller');

    // ---- 5. Stepped real-mouse edge auto-scroll (right then left) + drop on off-screen bay ----
    await washSc.evaluate((el) => { el.scrollLeft = 0; });
    await page.locator('#admin-content').evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(200);

    const cardIn = (colLabel) =>
      washRow.getByRole('region', { name: colLabel, exact: true }).getByRole('article', { name: ref, exact: true });
    const startCard = cardIn('Waiting · Wash');
    await startCard.waitFor();
    const dragHandle = startCard.locator('p').first();
    const startBox = await dragHandle.boundingBox();
    const scBox = await washSc.boundingBox();
    assert.ok(startBox && scBox, 'card and Wash scroller visible');

    // Verify lastAddedBay starts off-screen to the right
    const initialTargetLeft = await washRow.getByRole('region', { name: lastAddedBay, exact: true }).evaluate((el) => el.getBoundingClientRect().left);
    assert.ok(initialTargetLeft > scBox.x + scBox.width, 'target bay starts off-screen to the right');

    const putsBeforeDrag = puts.length;
    await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(startBox.x + startBox.width / 2 + 12, startBox.y + startBox.height / 2 + 8, { steps: 5 });
    await shot(page, 'p125-1280-drag-ready');

    // Move pointer into right edge zone (10px inside right edge of Wash scroller)
    const rightEdgeX = scBox.x + scBox.width - 10;
    const midY = scBox.y + Math.min(180, scBox.height / 2);
    await page.mouse.move(rightEdgeX, midY, { steps: 15 });

    // Confirm fade switched to pointer-events: auto to block Chrome's native ~2500px/s scroll
    const rightFadePE = await page.locator('[data-board-row-wrap="WASH"] [data-board-fade="right"]').evaluate((el) => getComputedStyle(el).pointerEvents);
    assert.equal(rightFadePE, 'auto', 'right edge fade uses pointer-events: auto while dragging');

    const rightSamples = [await washSc.evaluate((el) => Math.round(el.scrollLeft))];
    let shotTaken = false;
    for (let s = 0; s < 14; s++) {
      await page.mouse.move(rightEdgeX - (s % 2), midY, { steps: 2 });
      await page.waitForTimeout(70);
      await page.mouse.move(rightEdgeX, midY, { steps: 2 });
      await page.waitForTimeout(70);
      const cur = await washSc.evaluate((el) => Math.round(el.scrollLeft));
      rightSamples.push(cur);
      if (!shotTaken && cur >= 1300) {
        shotTaken = true;
        await shot(page, 'p125-1280-drag-scrolling');
      }
    }
    const maxRightScroll = Math.max(...rightSamples);
    assert.ok(maxRightScroll >= 700, 'holding near right edge scrolls the row right: ' + JSON.stringify(rightSamples));
    for (let i = 1; i < rightSamples.length; i++) {
      const stepDelta = rightSamples[i] - rightSamples[i - 1];
      assert.ok(stepDelta >= 0 && stepDelta <= 230, `smooth controlled right auto-scroll sample ${i}: delta=${stepDelta} in ${JSON.stringify(rightSamples)}`);
    }

    // Move pointer into left edge zone (12px inside left edge) and verify it scrolls left
    const leftEdgeX = scBox.x + 12;
    await page.mouse.move(leftEdgeX, midY, { steps: 15 });
    const leftSamples = [await washSc.evaluate((el) => Math.round(el.scrollLeft))];
    for (let s = 0; s < 5; s++) {
      await page.mouse.move(leftEdgeX + (s % 2), midY, { steps: 2 });
      await page.waitForTimeout(70);
      await page.mouse.move(leftEdgeX, midY, { steps: 2 });
      await page.waitForTimeout(70);
      leftSamples.push(await washSc.evaluate((el) => Math.round(el.scrollLeft)));
    }
    assert.ok(leftSamples[leftSamples.length - 1] < leftSamples[0] - 80, 'holding near left edge scrolls the row left: ' + JSON.stringify(leftSamples));

    // Scroll back to the right end so lastAddedBay is visible, then drop on lastAddedBay
    await page.mouse.move(rightEdgeX, midY, { steps: 10 });
    for (let s = 0; s < 8; s++) {
      await page.mouse.move(rightEdgeX - (s % 2), midY, { steps: 2 });
      await page.waitForTimeout(70);
    }
    const targetCol = washRow.getByRole('region', { name: lastAddedBay, exact: true });
    const targetBox = await targetCol.boundingBox();
    assert.ok(targetBox && targetBox.x < scBox.x + scBox.width, 'off-screen bay is now visible inside the row');
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + Math.min(140, targetBox.height / 2), { steps: 10 });
    await page.mouse.up();

    await page.getByRole('status').filter({ hasText: 'Car moved.' }).waitFor();
    await cardIn(lastAddedBay).waitFor();
    assert.equal(puts.length, putsBeforeDrag + 1, 'dropping on newly revealed column sends exactly one PUT');
    summary.edgeAutoScroll = { rightSamples, leftSamples, droppedBay: lastAddedBay, putsSent: puts.length - putsBeforeDrag };

    // Return card to Waiting · Wash via dropdown and verify sideways reveal (Section 6)
    await page.locator('#admin-content').evaluate((el) => { el.scrollTop = 180; });
    const scrollTopBeforeMove = await page.locator('#admin-content').evaluate((el) => Math.round(el.scrollTop));
    const movedCard = cardIn(lastAddedBay);
    await movedCard.getByLabel('Move ' + ref + ' to bay').selectOption({ index: 0 });
    await movedCard.getByRole('button', { name: 'Move car', exact: true }).click();
    await cardIn('Waiting · Wash').waitFor();
    await page.waitForTimeout(150);
    const afterReturn = await page.evaluate(() => ({
      scrollTop: Math.round(document.getElementById('admin-content').scrollTop),
      scrollLeft: Math.round(document.querySelector('[data-board-row-scroll="WASH"]').scrollLeft),
      activeId: document.activeElement?.id || '',
    }));
    assert.equal(afterReturn.scrollTop, scrollTopBeforeMove, 'sideways reveal after move does not change #admin-content.scrollTop');
    assert.equal(afterReturn.scrollLeft, 0, 'Waiting · Wash column revealed sideways to scrollLeft 0');
    assert.match(afterReturn.activeId, /^board-card-/, 'focus restored to moved card with preventScroll');

    // ---- 6. No board reload jump on window focus or Refresh board ----
    await washSc.evaluate((el) => { el.scrollLeft = 340; });
    await page.locator('#admin-content').evaluate((el) => { el.scrollTop = 240; });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const content = document.getElementById('admin-content');
      const sc = document.querySelector('[data-board-row-scroll="WASH"]');
      window.__p125ReloadProbe = {
        minRows: document.querySelectorAll('section[aria-label$=" row"]').length,
        minScrollTop: content.scrollTop,
        minScrollLeft: sc.scrollLeft,
      };
      const check = () => {
        const rows = document.querySelectorAll('section[aria-label$=" row"]').length;
        window.__p125ReloadProbe.minRows = Math.min(window.__p125ReloadProbe.minRows, rows);
        window.__p125ReloadProbe.minScrollTop = Math.min(window.__p125ReloadProbe.minScrollTop, content.scrollTop);
        window.__p125ReloadProbe.minScrollLeft = Math.min(window.__p125ReloadProbe.minScrollLeft, sc.scrollLeft);
      };
      new MutationObserver(check).observe(content, { childList: true, subtree: true });
      content.addEventListener('scroll', check);
      sc.addEventListener('scroll', check);
    });

    const focusReload = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/board' && r.status() === 200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await focusReload;
    await page.waitForTimeout(150);

    const refreshReload = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/board' && r.status() === 200);
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Refresh board').click();
    });
    await refreshReload;
    await page.waitForTimeout(150);

    const reloadStats = await page.evaluate(() => ({
      ...window.__p125ReloadProbe,
      finalScrollTop: Math.round(document.getElementById('admin-content').scrollTop),
      finalScrollLeft: Math.round(document.querySelector('[data-board-row-scroll="WASH"]').scrollLeft),
    }));
    assert.equal(reloadStats.minRows, 3, 'rows never unmount during window focus or Refresh board reload');
    assert.equal(reloadStats.finalScrollTop, 240, '#admin-content.scrollTop stays put across reloads');
    assert.equal(reloadStats.finalScrollLeft, 340, 'row scrollLeft stays put across reloads');
    summary.reloadPreservation = reloadStats;

    // ---- 7. M1: Refusal message visible inside viewport at 1440x900 and 390x844 (keyboard + drag) ----
    const tomorrow = manila(1);
    const expectedRefusal = `This booking is for ${dayLabel(tomorrow)}. It can start on that day.`;
    await page.getByLabel('Board day').fill(tomorrow);
    const futureCard = page.locator('section[aria-label="Detailing row"] article').first();
    await futureCard.waitFor();
    const futureRef = (await futureCard.getAttribute('aria-label')) ?? '';
    assert.match(futureRef, /^ZEUS-/, 'tomorrow Detailing booking present');

    const measureRefusal = () =>
      page.evaluate(() => {
        const status = document.querySelector('p[role="status"][aria-live="polite"]').getBoundingClientRect();
        const notice = document.querySelector('[data-board-notice="refusal"]')?.getBoundingClientRect() || null;
        const content = document.getElementById('admin-content').getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        const inViewport = (r) => Boolean(r && r.height > 0 && r.top >= content.top - 1 && r.bottom <= Math.min(content.bottom, vh) + 1 && r.left >= 0 && r.right <= vw);
        return {
          status: { top: Math.round(status.top), bottom: Math.round(status.bottom), height: Math.round(status.height) },
          content: { top: Math.round(content.top), bottom: Math.round(content.bottom) },
          scrollTop: Math.round(document.getElementById('admin-content').scrollTop),
          statusInViewport: inViewport(status),
          noticeInViewport: inViewport(notice),
        };
      });

    // 1440x900: refused keyboard move + refused drag
    const fCard1440 = () => page.getByRole('article', { name: futureRef, exact: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await fCard1440().scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);

    await fCard1440().getByLabel('Move ' + futureRef + ' to bay').selectOption({ label: 'QSA Detail A' });
    const put1440Key = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/bay$/.test(new URL(r.url()).pathname));
    await fCard1440().getByRole('button', { name: 'Move car', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal((await put1440Key).status(), 409, '1440x900 keyboard move refused with 409');
    await page.getByRole('status').filter({ hasText: expectedRefusal }).waitFor();
    await page.waitForTimeout(200);
    const m1440Key = await measureRefusal();
    assert.equal(m1440Key.statusInViewport, true, '1440x900 keyboard refusal is visible inside the viewport: ' + JSON.stringify(m1440Key));
    await shot(page, 'p125-1440x900-keyboard-refused');

    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await fCard1440().scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);

    const detailBay1440 = page.getByRole('region', { name: 'QSA Detail A', exact: true });
    const from1440 = await fCard1440().locator('p').first().boundingBox();
    const to1440 = await detailBay1440.boundingBox();
    const put1440Drag = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/bay$/.test(new URL(r.url()).pathname));
    await page.mouse.move(from1440.x + from1440.width / 2, from1440.y + from1440.height / 2);
    await page.mouse.down();
    await page.mouse.move(from1440.x + from1440.width / 2 + 12, from1440.y + from1440.height / 2 + 12, { steps: 5 });
    await page.mouse.move(to1440.x + to1440.width / 2, to1440.y + Math.min(120, to1440.height / 2), { steps: 20 });
    await page.mouse.up();
    assert.equal((await put1440Drag).status(), 409, '1440x900 drag move refused with 409');
    await page.getByRole('status').filter({ hasText: expectedRefusal }).waitFor();
    await page.waitForTimeout(200);
    const m1440Drag = await measureRefusal();
    assert.equal(m1440Drag.statusInViewport, true, '1440x900 drag refusal is visible inside the viewport: ' + JSON.stringify(m1440Drag));
    await shot(page, 'p125-1440x900-drag-refused');

    // 390x844: refused keyboard move + refused drag
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await fCard1440().scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);

    await fCard1440().getByLabel('Move ' + futureRef + ' to bay').selectOption({ label: 'QSA Detail A' });
    const put390Key = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/bay$/.test(new URL(r.url()).pathname));
    await fCard1440().getByRole('button', { name: 'Move car', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal((await put390Key).status(), 409, '390x844 keyboard move refused with 409');
    await page.getByRole('status').filter({ hasText: expectedRefusal }).waitFor();
    await page.waitForTimeout(200);
    const m390Key = await measureRefusal();
    assert.equal(m390Key.statusInViewport, true, '390x844 keyboard refusal is visible inside the viewport: ' + JSON.stringify(m390Key));
    await shot(page, 'p125-390x844-keyboard-refused');

    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await fCard1440().scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const waitingDetail390 = page.getByRole('region', { name: 'Waiting · Detailing + Coating', exact: true });
    const from390 = await fCard1440().locator('p').first().boundingBox();
    const to390 = await waitingDetail390.boundingBox();
    await page.mouse.move(from390.x + from390.width / 2, from390.y + from390.height / 2);
    await page.mouse.down();
    await page.mouse.move(from390.x + from390.width / 2 + 10, from390.y + from390.height / 2 + 10, { steps: 5 });
    await page.mouse.move(to390.x + to390.width / 2, to390.y + 24, { steps: 15 });
    await page.mouse.up();
    await page.getByRole('status').filter({ hasText: 'Return a car to its own Waiting queue.' }).waitFor();
    await page.waitForTimeout(200);
    const m390Drag = await measureRefusal();
    assert.equal(m390Drag.statusInViewport, true, '390x844 drag refusal is visible inside the viewport: ' + JSON.stringify(m390Drag));
    await shot(page, 'p125-390x844-drag-refused');

    summary.refusalVisibility = { m1440Key, m1440Drag, m390Key, m390Drag };
    assert.deepEqual(errors, []);
  } finally {
    try {
      if (page && createdBays.length) {
        await page.evaluate(async (names) => {
          const result = await (await fetch('/api/admin/bays')).json();
          for (const name of names) {
            const bay = (result.data || []).find((row) => row.name === name);
            if (bay?.isActive) {
              const res = await fetch('/api/admin/bays/' + bay.id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expectedUpdatedAt: bay.updatedAt, isActive: false }),
              });
              if (!res.ok) throw new Error('Synthetic bay cleanup failed for ' + name);
            }
          }
        }, createdBays);
      }
    } finally {
      if (outDir) {
        fs.writeFileSync(path.join(outDir, 'p125-browser-results.json'), JSON.stringify(summary, null, 2));
      }
      await browser.close();
    }
  }
});
