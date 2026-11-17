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

## LE cinematic revision — 17 November 2026

This section supersedes the earlier hero and CTA specification. LE requested a screen-fitting, image-led cinematic opening, more visible motion, Book now instead of Call to book, and prominent Manage booking. Implementation stays in the same isolated worktree; no server availability policy is changed.

The hero is now a viewport composition: 100svh minus the 98px desktop / 84px phone header and preview note. A flexible art row and compact copy row keep both actions visible together, including small phones and short laptops. A minimum height protects legibility on exceptionally short screens. The two immediate routes are `/book` and `/book/manage`; Book now always opens the booking page, which still controls actual availability. Paused/unknown notices stay explicit. Per-service paused telephone arrows remain state-aware; no booking is falsely confirmed.

The alpha car sits in front of monumental individual Zeus letters. Source: `public/media/landing-hero/zeus-car.png`, 1536×1024 RGBA, 1.91 MB, optimized responsively by Next Image. Created with the built-in image-generation tool from the original `/media/home/hero-poster.jpg`. It is an AI-assisted isolated hero illustration derived from the shop photo; original genuine gallery/process photos are unchanged. Final prompt: “Create an accurate clean transparent-background cutout of ONLY the exact white car in the input, including both side mirrors and every visible tire. Preserve the original front-three-quarter angle, exact car silhouette, body geometry, headlights, wheels, white paint, dark windshield, and honeycomb ceiling-light reflections. Remove the workshop, floor, shelves, air conditioner and every surrounding object completely. Do not change the car model or its details, do not invent logos or text, do not add shadows, smoke or a new background. Car fully visible, no cropped wheels or mirrors, tightly framed with modest transparent padding. Save as RGBA PNG with real alpha transparency.” The PNG's background sample alpha is zero and body sample alpha 253; it is a real transparent asset, not a black rectangle. Source generation output preserved under Codex generated_images; project copy committed.

Motion intensity is raised to 8/10 while maintaining native navigation and usable controls. Opening: letters rise 110% with -75° X rotation, .085s stagger over 1.15s; car enters from +9% X / +65px Y / -3° rotation / 1.12 scale over 1.65s; a bounded light sweep crosses behind it. Animation waits for the image and completes within 1.8s after load; focus completes it immediately. Phone receives only this opening, no scroll-linked scenes. All effects disappear under reduced motion.

Desktop scroll: the word recedes -48% Y at scale 1.18; the car moves +16% X / +34% Y / -7° rotation, scale 1.14. Workshop photo opens from inset 10%/12% with -4° rotation; service photos arrive with alternating tilt; coatings expand from a framed crop to full width; gallery images travel in opposing vertical directions; review cards settle from ±7° and +90px. The closing image pushes from 1.2 to 1. Lenis duration 1.05s, one GSAP ticker, no touch inertia, no pinning and complete cleanup. Animations remain decorative; no action or factual content requires their completion.

React Bits now contributes two visibly used interactions: a stronger Magnet button (maximum 9px, tilt 3°, scale 1.025; disabled for focus/coarse pointers/reduced motion) and an adapted ScrollFloat heading (word float / X rotation / stretch driven by scroll). ScrollFloat attribution shares the vendored React Bits license. The existing GSAP/React/Lenis stack is reused; no additional dependency installed for this revision.

Verification plan: regression RED for first-screen Book now/Manage booking across all statuses, then GREEN; preserve pricing/state/FAQ/proof checks; typecheck/lint/full tests/build on the source commit; a bounded desktop/phone screenshot pass plus viewport geometry checks at short and tall sizes, real scroll transform sampling, keyboard/reduced-motion checks and HTTP preview isolation. Independent release acceptance remains pending.

## LE correction: original workshop video, looping

The latest LE screenshot and instruction supersede the isolated-car hero and the earlier one-pass/no-loop direction. Restore the previous blended workshop-car composition with the original shop footage playing in a muted loop. The generated cutout stays preserved in history/assets but is no longer rendered or downloaded by the landing page. Preserve the viewport-fit layout, Book now and Manage booking, GSAP/React Bits/Lenis and the rest of the page.

Active media is `/media/home/hero-1080.mp4` (desktop) or `hero-720.mp4` (phones up to 800px), the shop's existing 14.5-second H.264 encodes. Posters are the corresponding original first-frame JPEGs. No new media generation or transcode. `LandingVideo` reuses the tested homepage playback controller, with landing-only visibility and manual-pause gates; shared homepage behavior is unchanged. Native `loop`, muted, playsInline, preload none. The client chooses and plays a file after load only when visible and permitted. The video pauses offscreen, in a hidden tab or by user request. Reduced motion/data saver/2G/autoplay failure keep the poster. A visible 44px Pause video/Play video control supports the newly requested continuous motion.

The workshop media again blends into the dark ground using vertical and horizontal edge masks, matching the LE screenshot. The media entrance is a small settle (scale 1.035→1, opacity .4→1, 1.1s); scroll uses a restrained upward travel (-8% Y, scale 1.04) so the full workshop frame stays aligned with the lettering and clear of the copy. This supersedes the cutout's diagonal flight. The four-letter entrance and lower-page cinematic choreography remain.

Verification: new loop/poster/no-JS/no-cutout contract first failed against the image hero, then passed after wiring the original footage. Existing per-screen media choice, data-saver, hidden-tab, autoplay-failure and reduced-motion controller tests remain. Browser acceptance must observe actual currentTime advancement, native loop wrap, manual pause/resume, offscreen pause and reduced-motion fallback; a screenshot alone is insufficient evidence of video playback.

## Motion reference revision: jjettas.com

LE supplied [jjettas.com](https://jjettas.com/) as the desired animation standard. Inspected the live desktop page at several scroll positions: layered foreground media, a diagonal change of scene, a horizontally travelling collection of perspective cards held against oversized background type, then larger scene changes. These observed composition principles guide Zeus; no athlete imagery, team marks, sponsor logos, audio, text or site code is imported.

Motion thesis: vehicle care becomes a sequence of tangible workshop panels. Keep the original looping Zeus footage and both booking actions. Add restrained pointer depth to the video plane and author one continuous horizontal care scene from the existing Wash / Detailing / Graphene photographs and links. The scene makes category alternatives clear; it is not a numbered service procedure or an invented result.

New deliberate constraint: on desktop >=1024px wide and >=700px tall, with no reduced-motion preference, the workshop viewport uses CSS sticky below the header for a 230svh parent journey. This is an explicitly introduced scroll-held scene inspired by the reference; it uses document scroll without a GSAP pin or page lock. Existing Lenis wheel smoothing remains. GSAP moves the photo panels horizontally, weaves their vertical/3D rotation/depth, shifts giant decorative type and fills a progress line. A diagonal background plane introduces the scene. Position functions use layout-space widths so perspective does not corrupt centering. First/middle/last panels center at progress 0/.5/1.

Keyboard focus on any card scrolls directly to that card's scene position and removes its perspective visually. Mobile, short windows, reduced motion and no-JS use the existing readable static grid with every link available. MatchMedia teardown removes the scene class, inline transforms and listeners; active focus is kept in view. A fine-pointer-only hero effect adds at most 10px translation and 2.5 degrees of tilt, resets on pointer leave/focus, and does not affect action controls.

Implementation: isolate care-scene choreography and pure centering/focus calculations; keep the existing video component/playback policy untouched. Add SSR fallback/destination and geometry regressions. Verify desktop scene entry/middle/exit, native section progression, keyboard targeting, responsive/reduced teardown, continuing video playback and preview isolation. Use bounded screenshot comparison and measured transforms. This adapts the reference's scene-based language to real Zeus media; it does not claim a duplicate WebGL model experience.

## Minimal opening refinement

LE asks for a transparent header at the top and less hero information. The header starts transparent with no visible bottom divider, gains the existing dark surface after 16px of scrolling, and stays opaque while the mobile menu is open. Returning to the top restores transparency. The passive listener is removed on unmount; reduced motion disables the surface transition.

Remove the decorative location and Precision / Protection / Pride annotations, the hero eyebrow and the second promotional sentence. Keep the headline, one service line (Car & motorcycle detailing), original looping footage and both booking actions. The preview label is shortened to Website preview. Shop location stays available in the page's substantive content and accessible heading; booking-state notices remain accurate. Scope is the opening only, preserving later scenes and services.

## LE refinement: uninterrupted footage and direct copy

LE explicitly removes the visible Pause video control. The original muted loop remains, with automatic offscreen/hidden-tab pause and reduced-motion/data-saver poster fallback. Removed manual playback UI and its local state/listeners. Hero headline now names the actual service: Car & motorcycle detailing. Removed the repeated service line beneath it. This supersedes the earlier visible playback control direction; later content is unchanged.

## Full-screen video opening
LE requests a full-screen video at the top. The original workshop footage now covers the entire first viewport, with the transparent sticky header and booking copy layered over it. Remove the preview strip from view and suppress the decorative ZEUS lettering/beam behind the footage. Remove edge masks; use a restrained dark overlay for navigation and text contrast. Keep small-screen minimum height, native loop and reduced-motion poster policy.

## Hero text and CTA placement
LE requests better text placement and removes the paused message from the opening. Move the headline to the lower-left, constrain its measure into two lines, and align the actions below it. Keep Book now as the single gold button; Manage booking becomes a plain secondary link. Remove hero availability notices for all states; booking routes, FAQ and later availability guidance remain authoritative. No availability setting is changed.

## Squared controls and simpler hero transition
LE rejects pill-shaped controls and the repeated three-column facts strip. Use 6px button corners, a clearer 52px desktop / 50px phone hero action and an unframed arrow. Remove the redundant vehicle/location/pricing strip entirely. Lead directly into the real workshop photo with a factual service introduction, replacing the pride/drive slogan and promotional filler. Location and pricing remain available in their relevant sections.

## Header booking action
LE asks to correct the header Book now styling. Replace its low-contrast outline with a compact off-white rectangular surface, dark text and a small directional arrow. Preserve 6px corners and 44px target height, neutral color hierarchy, /book destination and existing phone-menu behavior.

## HCI and motion refinement
LE asks for specialist refinement using UI/UX Pro Max, Superpowers and the existing React Bits/GSAP/Lenis stack. Use direct service-category labels and four section navigation links. Keep Book now primary, Manage booking secondary, consistent corners and stable touch targets. Bound the desktop headline measure, prevent phone action-label wrapping and group care content with its destination. Retain the full-screen loop and scroll-held workshop scene. Reduce magnetic translation to 5px with no tilt and make Lenis wheel response quicker (.85s); retain native touch, focus and reduced-motion exemptions. Add a small headline settle and reduce care-card entrance displacement. These changes apply familiar-label recognition, choice reduction, proximity and pointing-effort principles; customer testing remains necessary to establish usability or conversion outcomes.

## Expanded scroll choreography
LE asks for more visible text animation and distinct professional choreography. Add word-level GSAP sequences to the introduction, services/estimate, coatings, gallery, FAQ, visit and close using existing SplitType. Natural word wrapping preserves responsive layout. Introduction words turn upward, gallery words enter laterally, closing words rise farther; FAQ rows and visit panels reveal in separate stagger patterns. Keep the existing React Bits care heading and perspective workshop scene rather than duplicating them. Desktop word movement follows document scroll; phones use short one-time reveals. Original SSR content is visible, heading names remain accessible, keyboard focus completes its section's movement, and reduced-motion teardown restores original markup. No booking control gets a new reveal or delay. Motion expresses stages of the real service journey; it does not establish a measured conversion lift.

## Wider workshop and feedback placement
References reviewed online: [Longbow](https://longbowmotors.com/) for distinct photographic chapters, [Jimbo Wash](https://atlas-studio.eu/work/jimbo-wash) for service-focused interactions and [Glosswerk](https://coreconcepts.design/projects/glosswerk-car-detailing-studio-website/) for hands-on category exploration. The latter two are studio case studies, not independently verified conversion results. No reference assets or invented before/after results imported.

Use fluid desktop gutters (4vw, bounded 24�88px) so the layout occupies wide screens. Enlarge workshop photo panels to 42vw (380�680px), moderate their perspective and add explicit Wash/Detailing/Graphene scene controls with active states. Controls seek the native scroll position and settle the existing Lenis instance. No extra animation loop. Reduced/compact/no-JS keep normal category content; scene buttons are only displayed with the enhanced scene. Place compact customer experiences directly after workshop and before prices: left heading, right manual carousel, indexed position, disabled boundary arrows and labelled owner review slots. Retain keyboard/swipe/drag and no fabricated testimony. Existing React Bits headline/CTA and GSAP text choreography stay active.


## Natural workshop proportions, button-free auto-scrolling feedback, About and concerns sections
LE feedback: workshop photos were overly stretched with unnecessary scene buttons, customer feedback should drift automatically without buttons, and the landing page needs a distinct About section and a vehicle-care problems section.
- Workshop: Photos restored to natural 4:3 proportions (spect-ratio: 4/3, width clamp(300px, 30vw, 440px)), removed redundant scene buttons while keeping direct catalog service links and price links.
- Customer feedback: Converted to a continuous, button-free auto-scrolling drifting ribbon (48s linear infinite loop) with hover/focus/active pause and clean grid fallback under prefers-reduced-motion: reduce. Retains honest, clearly labelled preview slots without fabricated proof.
- About section: Dedicated section highlighting Zeus in Tacloban City, vehicle care approach, and direct consultation CTA.
- Everyday concerns section: Editorial breakdown of real vehicle problems (dirt/mud/grime, neglected interior, paint finish protection) directly linked to relevant care categories.
- Navigation: Header updated with 5 section links including About.
