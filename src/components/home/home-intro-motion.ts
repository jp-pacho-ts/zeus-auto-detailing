import { gsap } from "gsap";
import SplitType from "split-type";

export function playHomeIntro(root: HTMLElement, finish: () => void): () => void {
  const curtain = root.querySelector<HTMLElement>("[data-home-curtain]")!;
  const mark = root.querySelector<HTMLElement>(".zeus-intro__mark")!;
  const text = root.querySelector<HTMLElement>("[data-intro-text]")!;
  const split = new SplitType(text, { types: "words" });
  const content = root.querySelector<HTMLElement>("[data-home-content]")!;
  const timeline = gsap.timeline({ onComplete: finish, defaults: { ease: "power3.out" } });
  try {
    timeline.from(mark.querySelector("img"), { opacity: 0, y: 18, duration: .8 })
    .from(split.words, { opacity: 0, y: 12, stagger: .065, duration: .6 }, .3)
    .from(root.querySelector("[data-intro-line]"), { scaleX: 0, duration: .85, transformOrigin: "left" }, .45)
    .to(mark, { opacity: 0, y: -14, duration: .5 }, 1.65)
    .to(curtain, { yPercent: -100, duration: .85, ease: "power4.inOut" }, 1.95)
    .from(content, { y: 24, duration: .85 }, 1.95);
  } catch (error) {
    timeline.revert(); split.revert();
    throw error;
  }
  return () => { timeline.revert(); split.revert(); };
}
