# System Settings: side tabs, Bays moved to the Bay board

Date: 2026-11-24. Branch `jp-pacho-ts/settings-page-ui-fix`. Frontend only: no schema, API or service change.

## Why

The LE does not like the overall layout of the admin System Settings page. Today it is one scroll of six stacked
cards (about 2,900 px on desktop and 3,600 px on a phone). The section list never shows where you are, the title shows
twice, Opening hours and Closed days are styled differently from the other cards, labels and switches sit far apart on
wide screens, and the four status pills read as warnings even when nothing is wrong. Bays duplicates the Bay board,
which already adds, renames, moves and removes bays.

## Goals

- One section on screen at a time, picked from a side list that shows where you are.
- An Overview that says calmly whether the shop is running: colour only for something that needs action.
- Every section uses the same card style. Content is capped at a readable width so labels and controls stay close.
- Bays leave Settings. "Bring back" for a removed bay moves to the Bay board, so all bay work lives in one place.

## Non-goals

- No new settings, no backend or contract change, no change to the admin colours, fonts or shared components.
- No redesign of the Bay board beyond adding the removed-bays list.

## Anti-goals

- Losing any control that exists today (every setting stays reachable, and a removed bay can still be brought back).
- A page that looks unlike the other admin screens.

## Approaches considered

1. **Side tabs, one section at a time (picked by the LE).** Short page, clear "you are here", linkable sections. Costs:
   the largest change; the layout tests and the sticky summary bar change on purpose.
2. Keep the long page and fix it (scroll highlight, width cap, unified cards). Smallest change, but still a long scroll.
3. Overview plus a two-column grid. Unequal card heights leave ragged gaps; phones fall back to the long scroll.

For Bays, the LE picked "move Bring back to the Bay board" over dropping restore or keeping a restore-only list in
Settings.

## Design

### Settings (`src/components/admin/settings-tab.tsx`)

```
┌──────────────────┬───────────────────────────────────────────┐
│ ● Overview       │ Overview                                  │
│   Hours & closed │  Customer website   Live            View →│
│   Daily limits   │  Online booking     [Open | Paused]       │
│   Email          │  Email              Not set up      View →│
│   ────────────   │  Failed emails      0 in 7 days           │
│   Danger zone    │                                           │
└──────────────────┴───────────────────────────────────────────┘
Phone: the list becomes a sideways-scrolling row of chips above the content.
```

- Sections: Overview, Hours & closed days, Daily limits, Email, Danger zone (last, set apart, red).
- **Overview** replaces the sticky summary bar and the General card. It holds the Online booking switch (it was the
  only control in General) and one status row each for the website, email setup and failed emails. A row that needs
  action is amber or red; a healthy row is plain text. Status rows link to their section.
- Only the chosen section renders. The choice is kept in the URL as `?section=<id>` (replaceState, no reload), so a
  link or a refresh opens the same section. An unknown value falls back to Overview.
- Side list: buttons with `aria-current="page"` on the chosen one, 44 px targets. Choosing a section moves focus to its
  heading.
- The duplicate page heading "System Settings" goes; the portal header already shows it. Each section card's title is
  the heading.
- Content column capped near 48rem. Hours & closed days adopt the shared card shell (icon header, same padding and
  radius).
- On phones the On/Off and Open/Paused switches keep their natural width instead of stretching.
- Save feedback stays next to the section that saved.

### Bay board (`src/components/admin/bookings/bay-board.tsx`)

- Admin only, after Add container in the Bays area: a closed-by-default "Removed bays (N)" disclosure. It loads
  `GET /api/admin/bays` and lists bays with `isActive = false`.
- Each row: bay name, its container, and "Bring back <name>". A bay whose container was removed shows "Move to" first
  (the server refuses a bring-back into a removed container), same as Settings does today.
- After a change the board reloads through the existing `bayChanged`.
- Hidden when there are no removed bays.

### Removed code

- `src/components/admin/calendar/bay-manager.tsx` (only Settings used it). Its restore and move-orphan logic moves
  into the new removed-bays component.

## Tests and checks

- `settings-layout.test.ts` is rewritten for the new structure (section list order with Danger zone last, Overview
  status rows, booking switch locked by a server pause, non-admin message, `?section` fallback). The scroll-margin
  assertions go because sections no longer scroll into view. Behaviour that still exists keeps its assertion.
- New unit test for the removed-bays list (filters inactive bays, orphan bays offer Move first).
- `bay-controls.browser.check.cjs` and `containers.browser.check.cjs` click "Bring back" in Settings today. They are
  repointed to the Bay board's removed-bays list. Changing a browser check needs the LE's okay; approving this doc
  is that okay.
- typecheck, lint, `npm test`; before/after screenshots at 390, 768, 1024 and 1440.

## Left to the builder

Exact spacing, icon choice per section, the status row wording, and the chip row styling on phones, within the
existing admin tokens and components.
