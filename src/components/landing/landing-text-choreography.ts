import { gsap } from "gsap";
import SplitType from "split-type";

// Mounted inside the lifecycle media context; revert restores the original React markup.
export function mountTextChoreography(root: HTMLElement, desktop: boolean) {
  const restores: (() => void)[] = [];
  const headings = root.querySelectorAll<HTMLElement>(".landing-about h2, #landing-concerns-title, #services h2, #estimate h2, .landing-gallery h2, #landing-gallery-title, #visit h2, #landing-faq-title, #landing-band-title");
  headings.forEach((heading, index) => {
    const label = heading.getAttribute("aria-label");
    heading.setAttribute("aria-label", heading.textContent?.trim() ?? "");
    const split = new SplitType(heading, { types: "words", wordClass: "landing-reveal-word" });
    split.words?.forEach((word) => { word.setAttribute("aria-hidden", "true"); });
    heading.dataset.textScene = "true";
    const closing = heading.id === "landing-band-title";
    const gallery = heading.id === "landing-gallery-title";
    const animation = gsap.fromTo(split.words,
      { yPercent: desktop ? (closing ? 95 : 65) : 35, rotationX: desktop && !gallery ? -35 : 0, x: desktop && gallery ? 28 : 0, opacity: .12, transformPerspective: 800, transformOrigin: "50% 100%" },
      { yPercent: 0, rotationX: 0, x: 0, opacity: 1, stagger: desktop ? .085 : .035, duration: .65, ease: "power3.out", scrollTrigger: { trigger: heading, start: "top 94%", ...(desktop ? { end: "top 58%", scrub: .45 } : { once: true }) } });
    // Labels remain readable immediately when keyboard users enter the section.
    const section = heading.closest("section");
    const reveal = () => { animation.scrollTrigger?.getTween()?.progress(1); animation.progress(1); };
    section?.addEventListener("focusin", reveal);
    restores.push(() => { section?.removeEventListener("focusin", reveal); split.revert(); delete heading.dataset.textScene; if (label === null) heading.removeAttribute("aria-label"); else heading.setAttribute("aria-label", label); });
    if (index === 0) {
      const copy = root.querySelectorAll(".landing-about-copy > p:not(.landing-eyebrow)");
      gsap.fromTo(copy, { y: desktop ? 30 : 12, opacity: .3 }, { y: 0, opacity: 1, duration: .7, ease: "power3.out", scrollTrigger: { trigger: heading, start: "top 72%", once: true } });
    }
  });
  const rows = root.querySelectorAll(".landing-faq-item");
  const faq = gsap.fromTo(rows, { x: desktop ? -24 : 0, y: desktop ? 0 : 14, opacity: .45 }, { x: 0, y: 0, opacity: 1, stagger: .065, duration: .55, ease: "power3.out", scrollTrigger: { trigger: root.querySelector("#faq"), start: "top 82%", once: true } });
  const focusFaq = () => { faq.progress(1); };
  root.querySelector("#faq")?.addEventListener("focusin", focusFaq);
  restores.push(() => root.querySelector("#faq")?.removeEventListener("focusin", focusFaq));
  const visit = gsap.fromTo(root.querySelectorAll(".landing-visit-info"), { y: desktop ? 22 : 12 }, { y: 0, duration: .65, ease: "power3.out", scrollTrigger: { trigger: root.querySelector("#visit"), start: "top 84%", once: true } });
  const focusVisit = () => { visit.progress(1); };
  root.querySelector("#visit")?.addEventListener("focusin", focusVisit);
  restores.push(() => root.querySelector("#visit")?.removeEventListener("focusin", focusVisit));
  return () => restores.reverse().forEach((restore) => restore());
}
