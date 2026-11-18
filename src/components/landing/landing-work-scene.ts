import { gsap } from "gsap";

// Photos move inside their frames. The links and document scroll keep their natural positions.
export function mountCareScene(stage: HTMLElement) {
  stage.querySelectorAll(".landing-step-photo").forEach((frame) => {
    const photo = frame.querySelector("img");
    if (!photo) return;

    gsap.fromTo(photo, { scale: 1.12, yPercent: 3 }, {
      scale: 1,
      yPercent: 0,
      ease: "none",
      scrollTrigger: { trigger: frame, start: "top bottom", end: "top 32%", scrub: .4 },
    });
  });
}
