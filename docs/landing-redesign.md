# Zeus: care beyond the surface

## Brief and implementation plan

Direct LE request on 17 November 2026 authorizes rebuilding `/preview/landing` in the Orca worktree `jp-pacho-ts/redesign-landing-page`, based on local dev de69505. Earlier P1-91 worktrees and handoffs remain preserved. This implementation has sole custody of this worktree only. The explicit request for Lenis authorizes its package and lockfile addition; React Bits is used as a locally vendored component. Public `/`, booking, server logic and catalog calculations remain outside this redesign.

1. Inspect current preview and supplied LuxAuto rotating-reviews HTML. Capture before images.
2. Replace the presentation with a monumental Zeus hero, workshop introduction, care pathways, photographic work, existing live catalog/estimator/comparison, feedback slots, FAQ and visit/booking close.
3. Integrate scoped GSAP choreography and desktop Lenis; use React Bits Magnet for the hero action. Supply reduced-motion, keyboard, touch and no-JS behavior.
4. Verify existing behavior plus new section/content contracts. Inspect desktop, tablet and phone screenshots, keyboard controls, fallback states and motion cleanup. Record commands and limitations below.
5. Self-review and commit locally. Independent review, integrated QA and PM integration remain separate required stages; no push or release is performed.

## Audience and proposition

These are marketing hypotheses grounded in the shop's actual services, not commissioned market research.

| Audience | Pain / motivation | Objection | Desired result / response |
| --- | --- | --- | --- |
| Daily car and motorcycle owners in Tacloban | Dirt, daily wear and maintenance uncertainty | Is detailing more than a wash? | A simple care pathway explaining wash vs detailing vs protection |
| Owners who care about paint appearance | Swirls, dull paint, uncertainty about appropriate treatment | Will the service suit my paint? | Genuine workshop imagery, consultation and inspection for quote work |
| New vehicle / enthusiast owners | Want to maintain finish and choose protection | Which package and price applies to my vehicle? | Current catalog inclusions, size-specific prices and an estimate |
| Time-conscious returning customers | Need an easy repeat appointment | How do I book or change a visit? | Consistent booking action and Manage booking link |

Positioning: considered vehicle care in Tacloban, from regular washing to paint restoration and protection. Voice: calm, practical and confident. Avoid unsupported superlatives, performance promises, invented experience, warranties, review ratings or urgency.

## Sitemap, journey and conversion architecture

One complete marketing page with in-page navigation; existing `/book` and `/book/manage` are the supporting transaction routes. Navigation: Our approach, Services, Our work, Reviews, Visit. Secondary links: Estimate, Coatings, FAQ, phone and Messenger. No unsupported service routes are invented.

| Section | Layout and content | Conversion contribution |
| --- | --- | --- |
| Hero | Oversized ZEUS behind genuine car photography; “Care beyond the surface.”; factual local service description; booking + explore services | Immediate category/location clarity, emotional appeal and an actionable first screen |
| Fact strip | Cars + motorcycles, Tacloban location, size-specific pricing | Replaces invented statistics with useful decision facts |
| Our approach | Split genuine polishing image and concise explanation | Connects quality positioning to visible workshop activity |
| Find your care | Wash / detailing / protection cards linked to catalog categories | Helps novices self-select without navigating a large catalog first |
| What we do | Existing true category links with genuine work photographs, recast as three editorial cards | Shows actual work and moves interested visitors directly to services |
| Services + estimate | Existing catalog, size/body selection, add-ons and server estimator | Reduces price uncertainty while preserving unknown and quote-required states |
| Coatings comparison | Existing current catalog inclusion comparison | Helps compare Zeus packages without fabricated competitor claims |
| Gallery | Real process photos plus a clearly labelled finished-results slot | Uses honest photographic evidence; no fabricated before/after comparison |
| Feedback | Tilted horizontally scrollable cards labelled “Review awaiting owner approval”; manual previous/next controls | Review-ready structure without manufacturing social proof. Auto rotation starts only when real approved reviews are available |
| FAQ | Cost, time, booking, changes, motorcycles, hours, directions and package inclusions | Resolves practical objections at the decision point |
| Visit + close | Real address, landmark, contact, management link and state-aware booking action | Converts browsing into a visit or conversation. “Planning a visit?” creates a useful timing prompt without false scarcity |

Primary CTA follows actual booking status: Book an appointment / Call to book / Check online booking. Header remains neutral and mobile booking bar yields to visible gold controls. No fake timers, availability counts, invented discounts or scarcity. A real verified deadline can be added later if one exists.

## Visual identity and build specification

Mood: nocturnal, precise, considered. Signature: Zeus's four-letter name becomes architecture behind an actual car photographed in the shop. The supplied LuxAuto composition takes precedence over randomized skill layouts. MotionSites free examples Velorah and Creative Studio inform media layering and type scale only; supplied reference and existing brand override their fonts, looping videos and palettes.

DM Sans is loaded locally from `/fonts/home/DMSans.ttf` at weights 100–900. No external font requests. Hero word 30vw capped at 440px, weight 800, tracking -.08em. Desktop hero art is capped at 48svh to keep its action in the first laptop screen. Display heading clamp(40px, 4.4vw, 68px), leading 1.05; section headings clamp(32px, 3.7vw, 56px); body 16px / 1.7 and supporting copy 17px. Labels 12px / 1.5, tracking .18em. Phone title 40px and brand word 31vw. This follows LuxAuto's oversized branding while raising its tiny text for readability.

Palette uses existing brand roles: background #09090b, panels #18181b, secondary ground #121214, text #f5f5f4, muted #a1a1aa, gold #c08818 with hover #d49b28. Gold is confined to actions, section labels, tiny lines and progress; selected category uses a neutral light pill. Main content max-width 1200px with 32px minimum gutters (20px phone); vertical spacing 104px desktop / 64px phone; 24px grid gaps. Cards radius 14px, 1px neutral border; imagery 4:3 or wide editorial crops. No borrowed luxury-car imagery or fictitious staff.

Header height 74px, sticky, three navigation groups, 44px minimum interactions. Hero imagery uses original `/media/home/hero-poster.jpg` and phone derivative with soft edge blending; brand word behind photo, compact centered offer below. Work photos come from the existing stripped-metadata `/media/landing/` derivatives. Gallery process crops explicitly describe activities rather than implying before/after results.

Buttons: 48px high, gold primary, neutral outlined secondary. Hover: gold brightens, arrow shifts 2px; pointer-only images scale 1.025 within fixed frames. React Bits Magnet is restricted to fine pointers, max 5px, disabled for reduced motion and keyboard focus. Form selects preserve explicit labels, current values and existing server-error/retry/stale-result messaging; no validation or pricing engine is duplicated. Error contrast and focus rings use existing tokens.

GSAP: desktop word drifts -12% and hero photo +5% over hero exit (scrub .5), editorial photos settle from scale 1.04 to 1 at section entry, cards rise 18px in a .65s / .08 stagger with power2.out. Copy and CTA stay readable before hydration. Progress strip scales horizontally with document scroll. Lenis 1.3.27 uses duration .85, smoothWheel on desktop only, no touch inertia; uses one GSAP ticker and ScrollTrigger updates with teardown. No pinning or scroll locking. Reduced motion removes all animation and restores native scrolling. Phones retain static images/native scrolling due to the previous phone performance gate. Review slots never auto-move; actual review content must be approved before enabling a looping testimonial treatment.

## SEO and publishing strategy

Preview remains dynamic, noindex/nofollow and no-store. At separately approved public-home promotion, use title “Car & Motorcycle Detailing in Tacloban | Zeus Auto Detailing”, a truthful description mentioning wash/detailing/coatings and Tacloban, one descriptive H1, service/category H2/H3 hierarchy, existing booking/manage internal links and descriptive photo alt text. Target local service intent: car detailing Tacloban, motorcycle detailing Tacloban, graphene coating Tacloban, paint correction Tacloban. Service supporting pages should only be created when substantive approved content exists.

Use LocalBusiness/AutomotiveBusiness structured data only at publication and only with verified address, phone and canonical URL; confirm hours before including them. No Review/AggregateRating schema until legitimate eligible reviews exist. Maintain business name/address/phone consistency with owner-managed local profiles. Measure service navigation, estimate completion, booking start and contact clicks only after a consent/privacy-reviewed analytics implementation is authorized; no analytics is added here.

## Content still required from the owner

Approved review quotes and attribution/permission; genuine finished-result and before/after pairs; confirmed operating hours; any supported product certifications, warranty terms or promotion deadlines. The preview labels missing feedback/results explicitly and keeps uncertain claims out.

## Verification evidence

Initial redesign contract: `node --require ./src/server/__tests__/register.cjs --test src/components/landing/landing-redesign.test.ts` exited 1 (missing new `about` section); booking-state contract already passed. Final results and screenshot paths are appended after implementation.

The seven superseded assertions now protect the new equivalents: video-terminal poster → responsive original car photograph/no video; sticky doors → document-flow close without doors; exact old H1 → one H1 with new value proposition and local service description; feedback nested in Visit → dedicated labelled reviews destination; Barlow-only word → locally loaded DM Sans throughout. Existing pricing, state, accessibility, photo privacy and API behavior assertions remain. No tests are deleted or skipped by this change. Initial landing suite 28/35 passed; replacement suite 35/35 passed.

Pre-final checks: typecheck exit 0; lint exit 0; full test run exit 0 (993 tests: 580 passed, 413 existing DB-dependent skips); isolated production build exit 0. Runtime checked the actual production build: no phone overflow/broken images, menu Escape/focus restoration, FAQ disclosure, desktop Lenis, live reduced-motion teardown (Lenis false, image transform none). A separate uncommitted static SSR fixture with clearly synthetic catalog amounts checks populated service/comparison layout without using a live database; it is not proof of hydrated estimator or database integration.

Subjective visual self-review after desktop/phone inspection: first glance 8, signature 8, typography 8, composition 8, color 9, media 8, motion 7, mobile 8, copy 8, polish 8 (average 8.0). Batched improvements centered the hero label, increased the brand word, capped laptop hero height and made feedback cards draggable. These are author assessments, not independent review verdicts.

Actual guidance used: MotionSites (two free examples, specification and screenshot rubric), Design Taste (name-as-monument direction), UI/UX Pro Max (luxury automotive search, readable targets and motion), Writing Plans (this scoped handoff), Orca CLI (browser evidence), and Impeccable (craft review and mechanical findings). The supplied LuxAuto layout, current DM Sans/gold brand, direct implementation authorization and project ban on launching agents override conflicting skill defaults about random composition, replacement typography, extra design interviews or subagents. No additional skill installations or design-service accounts are required.

Third-party source: [React Bits Magnet](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Animations/Magnet/Magnet.tsx), vendored with its MIT + Commons Clause license beside the component. Settings synchronization is moved into an effect for React 19 lint compatibility. [Lenis integration guidance](https://github.com/darkroomengineering/lenis/blob/main/README.md) informs the shared GSAP ticker and teardown; Lenis is pinned to 1.3.27. Two file-scoped Impeccable exceptions retain the reference's intentional metallic word and dismiss an image-markup test false positive. No global ignore rules were added.

Final source-SHA verification and durable screenshots are recorded in local `.team/handoffs/landing-redesign-final.md`. Independent non-author fidelity review, performance acceptance, integrated QA and PM integration are still required before release. No push, production deployment or public-home promotion is performed.
