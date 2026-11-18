import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { careFocusProgress, careShotWindow, careTrackRange } from "./landing-scene-model";

// Only desktop gets the horizontal scene. The normal document flow is the fallback.
export function mountCareScene(stage: HTMLElement) {
  const viewport = stage.querySelector<HTMLElement>(".landing-stage-viewport");
  const track = stage.querySelector<HTMLElement>(".landing-stage-names");
  const progress = stage.querySelector(".landing-stage-progress i");
  const shotCounter = stage.querySelector("[data-workshop-shot]");
  const cards = [...stage.querySelectorAll<HTMLElement>(".landing-step")];
  if (!viewport || !track || !progress || !shotCounter || cards.length < 2) return;

  stage.classList.add("is-motion-scene");
  const range = () => careTrackRange(viewport.clientWidth, cards[0].offsetWidth, track.offsetWidth);
  const frameX = (index: number) => {
    const { start, end } = range();
    return gsap.utils.interpolate(start, end, careFocusProgress(index, cards.length));
  };
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
  for (const [index, shot] of shots.slice(1).entries()) {
    const start = shots[index].end;
    scene.fromTo(track, { x: () => frameX(index) }, {
      x: () => frameX(index + 1),
      duration: shot.start - start,
      ease: "sine.inOut",
      immediateRender: index === 0,
    }, start);
  }
  scene.fromTo(progress, { scaleX: 0 }, { scaleX: 1, duration: 1, ease: "none" }, 0);
  cards.forEach((card, index) => {
    const photo = card.querySelector("img");
    if (!photo) return;

    const shot = shots[index];
    const direction = index % 2 === 0 ? 1 : -1;
    const peripheral = { scale: 1.15, xPercent: -3 * direction, filter: "brightness(.52) saturate(.58)" };
    const featured = { scale: 1.04, xPercent: -direction, filter: "brightness(1) saturate(.94)" };
    const settled = { ...featured, scale: 1.07, xPercent: direction };
    if (index > 0) {
      const approach = shots[index - 1].end;
      scene.fromTo(photo, peripheral, {
        ...featured,
        duration: shot.start - approach,
        ease: "sine.inOut",
      }, approach);
    }
    scene.fromTo(photo, featured, {
      ...settled,
      duration: shot.end - shot.start,
      ease: "none",
      immediateRender: index === 0,
    }, shot.start);
    if (index < cards.length - 1) {
      scene.fromTo(photo, settled, {
        ...peripheral,
        xPercent: 3 * direction,
        duration: shots[index + 1].start - shot.end,
        ease: "sine.inOut",
        immediateRender: false,
      }, shot.end);
    }
  });

  let currentShot = 0;
  scene.eventCallback("onUpdate", () => {
    const index = Math.round(scene.progress() * (cards.length - 1));
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
