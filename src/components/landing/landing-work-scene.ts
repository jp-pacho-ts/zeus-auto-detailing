import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { careFocusProgress, careShotIndexAtProgress, careShotWindow } from "./landing-scene-model";

// Only desktop gets the horizontal scene. The normal document flow is the fallback.
export function mountCareScene(stage: HTMLElement) {
  const progress = stage.querySelector(".landing-stage-progress i");
  const shotCounter = stage.querySelector("[data-workshop-shot]");
  const cards = [...stage.querySelectorAll<HTMLElement>(".landing-step")];
  if (!progress || !shotCounter || cards.length < 2) return;

  stage.classList.add("is-motion-scene");
  const shots = cards.map((_, index) => careShotWindow(index, cards.length));
  const scene = gsap.timeline({
    scrollTrigger: {
      trigger: stage,
      start: "top 74px",
      end: "bottom bottom",
      scrub: .38,
      invalidateOnRefresh: true,
    },
  });
  scene.fromTo(progress, { scaleX: 0 }, { scaleX: 1, duration: 1, ease: "none" }, 0);
  // LE 2026-11-20 cut: the outgoing title leaves through a mask, the shot pushes in and falls into shadow, and the
  // next shot opens from a centred frame to full bleed (a camera iris) before its title rises in. Titles never overlap.
  const parts = cards.map((card) => ({
    frame: card.querySelector(".landing-step-photo"),
    photo: card.querySelector("img"),
    title: card.querySelector("h3"),
    extras: card.querySelectorAll(".landing-step-links, .landing-step-prices"),
  }));
  const shown = { yPercent: 0, clipPath: "inset(0% 0% 0% 0%)" };
  const opened = { scale: 1.035, xPercent: 0 };
  const settled = { scale: 1.07, xPercent: -1.5 };
  parts.forEach(({ frame, photo, title, extras }, index) => {
    const shot = shots[index];
    if (index > 0) {
      const approach = shots[index - 1].end;
      const duration = shot.start - approach;
      const prev = parts[index - 1];
      if (prev.title) scene.fromTo(prev.title, shown, { yPercent: -100, clipPath: "inset(100% 0% 0% 0%)", duration: duration * .4, ease: "power2.in", immediateRender: false }, approach);
      if (prev.extras.length) scene.fromTo(prev.extras, { opacity: 1 }, { opacity: 0, duration: duration * .3, ease: "none", immediateRender: false }, approach);
      if (prev.photo) scene.fromTo(prev.photo, { ...settled, filter: "saturate(.88) brightness(1)" }, { scale: 1.16, xPercent: -3, filter: "saturate(.88) brightness(.28)", duration, ease: "power1.in", immediateRender: false }, approach);
      // From a point, so a waiting shot is invisible until its own cut.
      if (frame) scene.fromTo(frame, { clipPath: "inset(50% 50% 50% 50%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration, ease: "power3.inOut" }, approach);
      if (photo) scene.fromTo(photo, { scale: 1.45, xPercent: 0 }, { ...opened, duration, ease: "power2.out" }, approach);
      if (title) scene.fromTo(title, { yPercent: 100, clipPath: "inset(0% 0% 100% 0%)" }, { ...shown, duration: duration * .45, ease: "power3.out" }, approach + duration * .55);
      if (extras.length) scene.fromTo(extras, { opacity: 0 }, { opacity: 1, duration: duration * .3, ease: "none" }, approach + duration * .7);
    }
    if (photo) scene.fromTo(photo, opened, { ...settled, duration: shot.end - shot.start, ease: "none", immediateRender: index === 0 }, shot.start);
  });
  // The first shot is already on screen as the stage arrives: its photo settles and its title rises before the pin.
  const first = parts[0];
  const arrival = { trigger: stage, start: "top bottom", end: "top 74px", scrub: .5 };
  if (first.photo) gsap.fromTo(first.photo, { scale: 1.22, xPercent: 0 }, { ...opened, ease: "none", scrollTrigger: arrival });
  if (first.title) gsap.fromTo(first.title, { yPercent: 100, clipPath: "inset(0% 0% 100% 0%)" }, { ...shown, ease: "power3.out", scrollTrigger: { ...arrival, start: "top 55%" } });

  let currentShot = 0;
  scene.eventCallback("onUpdate", () => {
    const index = careShotIndexAtProgress(scene.progress(), cards.length);
    if (index === currentShot) return;
    currentShot = index;
    shotCounter.textContent = String(index + 1).padStart(2, "0");
  });

  let pointerLink: Element | null = null;
  let resetPointer = 0;
  const rememberPointerLink = (event: PointerEvent) => {
    pointerLink = event.target instanceof Element ? event.target.closest("a") : null;
    cancelAnimationFrame(resetPointer);
    resetPointer = requestAnimationFrame(() => { pointerLink = null; });
  };
  const revealFocusedCard = (event: FocusEvent) => {
    const target = event.target;
    const trigger = scene.scrollTrigger;
    if (!(target instanceof HTMLElement) || target === pointerLink || !trigger) return;
    const index = cards.findIndex((card) => card.contains(target));
    if (index < 0) return;

    const position = careFocusProgress(index, cards.length);
    window.scrollTo({ top: trigger.start + (trigger.end - trigger.start) * position, behavior: "instant" });
    ScrollTrigger.update();
    trigger.getTween()?.progress(1);
    scene.progress(position);
  };
  stage.addEventListener("pointerdown", rememberPointerLink);
  stage.addEventListener("focusin", revealFocusedCard);
  return () => {
    cancelAnimationFrame(resetPointer);
    stage.removeEventListener("pointerdown", rememberPointerLink);
    stage.removeEventListener("focusin", revealFocusedCard);
    stage.classList.remove("is-motion-scene");
    shotCounter.textContent = "01";
    const active = document.activeElement;
    if (active instanceof HTMLElement && stage.contains(active)) {
      requestAnimationFrame(() => { if (active.isConnected) active.scrollIntoView({ block: "center", behavior: "instant" }); });
    }
  };
}
