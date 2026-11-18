import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { careFocusProgress, careTrackRange } from "./landing-scene-model";

// Only desktop gets the horizontal scene. The normal document flow is the fallback.
export function mountCareScene(stage: HTMLElement) {
  const viewport = stage.querySelector<HTMLElement>(".landing-stage-viewport");
  const track = stage.querySelector<HTMLElement>(".landing-stage-names");
  const progress = stage.querySelector(".landing-stage-progress i");
  const cards = [...stage.querySelectorAll<HTMLElement>(".landing-step")];
  if (!viewport || !track || !progress || cards.length < 2) return;

  stage.classList.add("is-motion-scene");
  const range = () => careTrackRange(viewport.clientWidth, cards[0].offsetWidth, track.offsetWidth);
  const scene = gsap.timeline({
    scrollTrigger: {
      trigger: stage,
      start: "top 74px",
      end: "bottom bottom",
      scrub: .28,
      invalidateOnRefresh: true,
    },
  });
  scene.fromTo(track, { x: () => range().start }, { x: () => range().end, duration: 1, ease: "none" }, 0);
  scene.fromTo(progress, { scaleX: 0 }, { scaleX: 1, duration: 1, ease: "none" }, 0);
  cards.forEach((card, index) => {
    const photo = card.querySelector("img");
    if (!photo) return;

    const arrival = careFocusProgress(index, cards.length);
    if (arrival > 0) {
      scene.fromTo(photo, { scale: 1.07 }, { scale: 1, duration: arrival, ease: "sine.out" }, 0);
    }
    if (arrival < 1) {
      scene.to(photo, { scale: 1.07, duration: 1 - arrival, ease: "sine.in" }, arrival);
    }
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
    const active = document.activeElement;
    if (active instanceof HTMLElement && stage.contains(active)) {
      requestAnimationFrame(() => { if (active.isConnected) active.scrollIntoView({ block: "center", behavior: "instant" }); });
    }
  };
}
