# System Settings side tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn System Settings into side tabs (one section at a time, Overview first) and move bay restoring from Settings to the Bay board.

**Architecture:** Pure section/overview logic lives in the existing `settings/settings-model.ts` and is unit tested; `settings-tab.tsx` renders the chosen section only and keeps it in `?section=`. A new `bookings/removed-bays.tsx` lists removed bays on the Bay board over the existing bay routes; `calendar/bay-manager.tsx` is deleted.

**Tech Stack:** Next.js 16 App Router, React 19, strict TypeScript, Tailwind 4, node:test with `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-11-24-settings-side-tabs-design.md`

## Global Constraints

- Frontend only: no change under `src/server`, `src/app/api`, `prisma`, `src/types`.
- Reuse admin tokens and components (`Button`, `Select`, `fieldClass`, `LoadState`, `useAdminResource`, `useAdminWrite`/`WriteFeedback`, `adminRequest`). No new dependency.
- Interactive targets at least 44 px, written as px classes (`min-h-[44px]`): the admin root font is 92.5%.
- Danger zone stays last in the list and keeps its red border.
- Section ids: `overview`, `hours`, `limits`, `email`, `danger`. URL form: `?section=<id>`; anything else means `overview`.
- No test deleted, skipped or weakened; assertions for behaviour that still exists are kept.
- Verify in a worktree, never the canonical root. Commands: `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`.

## Review Focus

- `?section=bays` (an old link to the removed section) or `?section=` garbage: Overview opens, no crash. Test in Task 1.
- Server-paused booking (`bookingPausedByServer`): the Overview switch is shown but locked, and its line says why. Test in Task 2.
- A removed bay whose container was also removed: no Bring back until it is moved. Test in Task 3.
- No removed bays at all: the Bay board shows no empty "Removed bays (0)" block. Test in Task 3.
- A non-admin opening Settings: plain message, no tabs, no fetch. Test in Task 2 (kept from today).

---

### Task 1: Section and overview model

**Files:**
- Modify: `src/components/admin/settings/settings-model.ts`
- Test: `src/components/admin/settings/settings-model.test.ts`

**Interfaces:**
- Produces:
  - `export type SettingsSection = "overview" | "hours" | "limits" | "email" | "danger";`
  - `export const SETTINGS_SECTIONS: readonly [SettingsSection, string][]` = `[["overview","Overview"],["hours","Hours & closed days"],["limits","Daily limits"],["email","Email"],["danger","Danger zone"]]`
  - `export function sectionFromSearch(search: string): SettingsSection` (reads `section` from a `location.search` string)
  - `export type OverviewRow = { label: string; value: string; tone: "ok" | "warn" | "bad"; section: SettingsSection | null };`
  - `export function overviewRows(s: AdminShopSettings): OverviewRow[]` — rows in order: Customer website, Email, Failed emails (7 days). Online booking is a switch, not a row.

- [ ] **Step 1: Write the failing tests**

```ts
test("sectionFromSearch: known ids open, anything else is Overview", () => {
  assert.equal(sectionFromSearch("?section=email"), "email");
  assert.equal(sectionFromSearch("?section=danger&x=1"), "danger");
  for (const s of ["", "?section=bays", "?section=", "?section=EMAIL", "?other=1"]) assert.equal(sectionFromSearch(s), "overview", s);
});
test("overviewRows: plain when healthy, coloured only when something needs action", () => {
  assert.deepEqual(overviewRows(settings({ email: { configured: true, failedLast7Days: 0, waitingLast7Days: 0 } })).map((r) => [r.label, r.value, r.tone, r.section]), [
    ["Customer website", "Live", "ok", "danger"],
    ["Email", "Set up", "ok", "email"],
    ["Failed emails, 7 days", "0", "ok", "email"],
  ]);
  const bad = overviewRows(settings({ maintenance: true, email: { configured: false, failedLast7Days: 3, waitingLast7Days: 1 } }));
  assert.deepEqual(bad.map((r) => [r.value, r.tone]), [["Under maintenance", "warn"], ["Not set up", "warn"], ["3", "bad"]]);
});
```

(`settings(...)` is the existing factory at the top of `settings-model.test.ts`.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --require ./src/server/__tests__/register.cjs --test src/components/admin/settings/settings-model.test.ts`
Expected: FAIL, `sectionFromSearch is not a function`.

- [ ] **Step 3: Implement the four exports in `settings-model.ts`** with `URLSearchParams`; values exactly as the test.

- [ ] **Step 4: Run to verify they pass** (same command, all tests PASS).

- [ ] **Step 5: Commit** `feat(settings): section ids and overview rows for side tabs`.

### Task 2: Settings side tabs

**Files:**
- Create: `src/components/admin/settings/section-card.tsx` (moved `SectionCard` from `settings-tab.tsx`, exported, `"use client"` not needed)
- Modify: `src/components/admin/settings-tab.tsx`
- Modify: `src/components/admin/calendar/hours-manager.tsx` (its two `<section>`s become `SectionCard`s: ids `settings-hours-week` / `settings-hours-closed`, icons `Clock` / `CalendarOff`, titles "Opening hours" / "Closed days", existing intro text)
- Test: `src/components/admin/settings/settings-layout.test.ts`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `SectionCard({ id, icon, title, intro, danger?, children })` unchanged props; `id` stays the heading anchor (`id + "-title"`).

Layout decisions:
- Drop the "System Settings" `<h2>`, the sticky "Settings summary" nav, the General card and the "Jump to a section" select.
- Wrapper: `lg:grid lg:grid-cols-[13rem_minmax(0,48rem)] lg:gap-8`. Side list `<nav aria-label="Settings sections">`, buttons with `aria-current="page"` on the chosen one (chosen: `bg-raised text-foreground` plus a 2 px primary left bar; others muted). A divider (`border-t`) before Danger zone, whose label is rose.
- Below lg the same nav renders as one `flex overflow-x-auto gap-2` chip row (no wrap), chips `min-h-[44px] whitespace-nowrap`.
- State: `const [section, setSection] = useState<SettingsSection>("overview")`; on mount `setSection(sectionFromSearch(location.search))`; choosing calls `history.replaceState(null, "", "?section=" + id)` (Overview: drop the query) then focuses `#settings-<id>-title` after render.
- Overview card (`id="settings-overview"`, icon `Gauge`): first the existing Online booking row and `Choice` (unchanged label "New bookings", same disabled rule and `save(..., "settings-overview")`), then a `<dl>` of `overviewRows`; each row with a `section` ends in a `Button variant="ghost"` "View" that selects that section. Tone: `ok` = foreground text, `warn` = amber-400, `bad` = rose-400, each with a 2 px dot.
- `Choice` wrapper gets `self-start` so it never stretches on phones.
- Feedback ids: `settings-overview`, `settings-email`, `settings-danger`.

- [ ] **Step 1: Rewrite the layout tests** (replace the "one summary bar…" and "maintenance on and paused…" tests; keep the non-admin and Daily limits tests as they are; delete the Bays test here — Task 3 adds its replacement).

```ts
test("Settings: side list in order, Danger zone last, Overview shown first", () => {
  const html = renderSettings("ADMIN", settings());
  const list = html.match(/<nav aria-label="Settings sections"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.deepEqual([...list.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].replace("&amp;", "&")),
    ["Overview", "Hours & closed days", "Daily limits", "Email", "Danger zone"]);
  assert.match(list, /aria-current="page"[^>]*>Overview</);
  assert.match(html, /id="settings-overview"/);
  for (const gone of ["settings-email", "settings-danger", "settings-bays", "Settings summary", "Jump to a section", ">System Settings<"]) assert.equal(html.includes(gone), false, gone);
  assert.doesNotMatch(html, /Railway/);
});
test("Settings: Overview shows status rows; a server pause locks the booking switch", () => {
  const html = renderSettings("ADMIN", settings({ maintenance: true, bookingPausedByServer: true, email: { configured: true, failedLast7Days: 0, waitingLast7Days: 0 } }));
  assert.match(html, />Under maintenance</);
  assert.match(html, />Set up</);
  assert.match(html, /<button type="button" aria-pressed="false" disabled=""[^>]*>Open</, "a server pause cannot be undone here");
});
```

- [ ] **Step 2: Run** `node --require ./src/server/__tests__/register.cjs --test src/components/admin/settings/settings-layout.test.ts` — Expected: the two new tests FAIL.
- [ ] **Step 3: Implement** the layout above; move `SectionCard` to `section-card.tsx`; restyle `hours-manager.tsx`; remove the `BayManager`/`useAdminResource<AdminBay[]>`/`baySummary`/`jump`/`go` code from `settings-tab.tsx`.
- [ ] **Step 4: Run** the same command — all PASS; then `npm.cmd run typecheck` and `npm.cmd run lint` exit 0.
- [ ] **Step 5: Look at it** on the dev preview (`http://127.0.0.1:3100/admin/settings`) at 390, 768, 1024, 1440: each section, `?section=bays`, a save on Overview and Email. Document stays unscrollable (`#admin-content` scrolls); no sideways scroll except the phone chip row.
- [ ] **Step 6: Commit** `feat(settings): side tabs with an Overview, one section at a time`.

### Task 3: Removed bays on the Bay board; delete BayManager

**Files:**
- Create: `src/components/admin/bookings/removed-bays.tsx`
- Modify: `src/components/admin/bookings/bay-board.tsx` (mount after `<AddContainer …/>`, admin only)
- Delete: `src/components/admin/calendar/bay-manager.tsx`
- Test: `src/components/admin/bookings/removed-bays.test.ts`
- Modify: `src/components/admin/bookings/bay-controls.browser.check.cjs:128-129`, `src/components/admin/bookings/containers.browser.check.cjs:221-245`

**Interfaces:**
- Produces:
  - `export type RemovedBay = { bay: AdminBay; container: AdminContainer | null };` (`null` = its container was removed)
  - `export function removedBays(bays: readonly AdminBay[], containers: readonly AdminContainer[]): RemovedBay[]` — inactive bays only, sorted by container sortOrder then bay sortOrder, orphans last.
  - `export function RemovedBays({ refresh, onDone }: { refresh: unknown; onDone: (text: string) => Promise<unknown> })` — fetches `/api/admin/bays` and `/api/admin/bay-containers` with `useAdminResource`, reloads both when `refresh` changes (pass the board object).

Rendering: nothing when the list is empty. Otherwise `<details>` with `<summary>` "Removed bays (N)" (`min-h-[44px]`), inside `<ul aria-label="Removed bays">`. Row: name, muted container name ("Container removed" for orphans), then either `Button variant="outline"` "Bring back <name>" (`PATCH /api/admin/bays/<id>` `{ expectedUpdatedAt, isActive: true }`, success text `<name> is back in use.`) or, for an orphan, a `Select aria-label="Move <name> to"` of active containers plus "Move bay" (`POST /api/admin/bays/<id>/move` `{ expectedUpdatedAt, containerId }`, success `<name> moved to <container>.`). Writes go through `useAdminWrite().run`, errors show in `WriteFeedback`, success calls `onDone(text)` (the board's `bayChanged`).

- [ ] **Step 1: Write the failing tests**

```ts
test("removedBays: only removed bays, by container order, orphans last", () => {
  const c = (id: string, sortOrder: number) => ({ id, name: id, sortOrder }) as AdminContainer;
  const b = (id: string, containerId: string, sortOrder: number, isActive = false) => ({ id, name: id, containerId, sortOrder, isActive, updatedAt: "x" }) as AdminBay;
  const rows = removedBays([b("p2", "paint", 2), b("w1", "wash", 1), b("live", "wash", 3, true), b("t1", "gone", 1), b("p1", "paint", 1)], [c("paint", 2), c("wash", 1)]);
  assert.deepEqual(rows.map((r) => [r.bay.id, r.container?.id ?? null]), [["w1", "wash"], ["p1", "paint"], ["p2", "paint"], ["t1", null]]);
  assert.deepEqual(removedBays([b("live", "wash", 1, true)], [c("wash", 1)]), []);
});
```

Plus a `renderToStaticMarkup` test with `useAdminResource` mocked (pattern: `settings-layout.test.ts` "Daily limits" test): with one removed bay in an active container the markup contains `Removed bays (1)` and `>Bring back w1<`; an orphan row contains `aria-label="Move t1 to"` and no `Bring back t1`; with no removed bays the markup is empty.

- [ ] **Step 2: Run** `node --require ./src/server/__tests__/register.cjs --test src/components/admin/bookings/removed-bays.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `removed-bays.tsx`, mount it in `bay-board.tsx` as `{role === "ADMIN" && <RemovedBays refresh={board} onDone={bayChanged} />}`, delete `bay-manager.tsx`.
- [ ] **Step 4: Repoint the browser checks**: after removing a bay they open the Bay board's "Removed bays" disclosure instead of the Settings Bays tab, and find "Bring back <name>" / "Move <name> to" inside `getByRole('list', { name: 'Removed bays' })`. Keep every assertion's intent (removed bay restorable; orphan cannot be brought back until moved; nothing left orphaned; fits 1280/1024/768/390 without sideways scroll). These checks are already stale elsewhere on dev (P1-70 C group); record that, do not claim they pass unless run.
- [ ] **Step 5: Run** the unit test (PASS), `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint` (all exit 0). On the preview: remove a bay from its menu, open Removed bays, bring it back.
- [ ] **Step 6: Commit** `feat(bay-board): bring back removed bays on the board; Settings no longer manages bays`.

### Task 4: Evidence

- [ ] Before/after screenshots at 390, 768, 1024, 1440 of Settings (each section) and the Bay board removed-bays list, saved to the scratchpad (synthetic data only).
- [ ] Run the Impeccable detector once: `impeccable detect --json --changed` — no unexplained findings.
- [ ] Record commands, exit codes and skipped checks (browser checks not run, if so) in the final report.
