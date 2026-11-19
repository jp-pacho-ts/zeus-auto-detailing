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
  cards.forEach((card, index) => {
    const shot = shots[index];
    const photo = card.querySelector("img");
    const title = card.querySelector("h3");
    const opened = { scale: 1.035, xPercent: 0 };
    const settled = { scale: 1.07, xPercent: -1.5 };
    if (index > 0) {
      const approach = shots[index - 1].end;
      const duration = shot.start - approach;
      // Reveal the next photo across the same frame so the cut reads horizontally.
      scene.fromTo(card, { clipPath: "inset(0 0 0 100%)" }, {
        clipPath: "inset(0 0 0 0%)",
        duration,
        ease: "sine.inOut",
        immediateRender: true,
      }, approach);
      if (photo) {
        scene.fromTo(photo, { scale: 1.15, xPercent: 5 }, { ...opened, duration, ease: "sine.out" }, approach);
      }
      if (title) {
        scene.fromTo(title, { x: 30 }, { x: 0, duration, ease: "power2.out" }, approach);
      }
    }
    if (!photo) return;
    scene.fromTo(photo, opened, {
      ...settled,
      duration: shot.end - shot.start,
      ease: "none",
      immediateRender: index === 0,
    }, shot.start);
    if (index < cards.length - 1) {
      scene.to(photo, {
        scale: 1.1,
        xPercent: -3,
        duration: shots[index + 1].start - shot.end,
        ease: "sine.in",
      }, shot.end);
    }
  });

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
