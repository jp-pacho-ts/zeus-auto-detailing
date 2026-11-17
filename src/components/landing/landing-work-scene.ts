import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { careFocusProgress, careTrackRange } from "./landing-scene-model";

// Called inside the lifecycle's media context so every tween/trigger is reverted together.
export function mountCareScene(stage: HTMLElement) {
  const viewport = stage.querySelector<HTMLElement>(".landing-stage-viewport");
  const track = stage.querySelector<HTMLElement>(".landing-stage-names");
  const cards = [...stage.querySelectorAll<HTMLElement>(".landing-step")];
  if (!viewport || !track || cards.length < 2) return () => {};
  stage.classList.add("is-motion-scene");
  const range = () => careTrackRange(viewport.clientWidth, cards[0].offsetWidth, track.offsetWidth);
  const scene = gsap.timeline({ scrollTrigger: { trigger: stage, start: "top 74px", end: "bottom bottom", scrub: .6, invalidateOnRefresh: true } });
  scene.fromTo(track, { x: () => range().start }, { x: () => range().end, duration: 1, ease: "none" }, 0);
  cards.forEach((card, index) => {
    const direction = index % 2 ? 1 : -1;
    scene.fromTo(card,
      { y: direction * 42, rotation: direction * 7, rotationY: 24, z: -90, transformPerspective: 1000, transformOrigin: "50% 50%" },
      { y: -direction * 42, rotation: -direction * 5, rotationY: -24, z: -35, duration: 1, ease: "none" }, 0);
  });
  const backdrop = stage.querySelector(".landing-stage-backdrop");
  if (backdrop) scene.fromTo(backdrop, { xPercent: 6 }, { xPercent: -18, duration: 1, ease: "none" }, 0);
  const progress = stage.querySelector(".landing-stage-progress i");
  if (progress) scene.fromTo(progress, { scaleX: 0 }, { scaleX: 1, duration: 1, ease: "none" }, 0);
  const wipe = stage.querySelector(".landing-stage-wipe");
  if (wipe) gsap.fromTo(wipe, { yPercent: 85, rotation: -8 }, { yPercent: -110, rotation: -8, ease: "none", scrollTrigger: { trigger: stage, start: "top bottom", end: "top top", scrub: .4 } });
  const focus = (event: FocusEvent) => {
    if (!(event.target instanceof Node)) return;
    const index = cards.findIndex((card) => card.contains(event.target as Node));
    const trigger = scene.scrollTrigger;
    if (index < 0 || !trigger) return;
    const progress = careFocusProgress(index, cards.length);
    window.scrollTo({ top: trigger.start + (trigger.end - trigger.start) * progress, behavior: "instant" });
    ScrollTrigger.update();
    trigger.getTween()?.progress(1);
    scene.progress(progress);
  };
  stage.addEventListener("focusin", focus);
  return () => {
    stage.removeEventListener("focusin", focus);
    stage.classList.remove("is-motion-scene");
    const active = document.activeElement;
    if (active instanceof HTMLElement && stage.contains(active)) requestAnimationFrame(() => { if (active.isConnected) active.scrollIntoView({ block: "center", behavior: "instant" }); });
  };
}
