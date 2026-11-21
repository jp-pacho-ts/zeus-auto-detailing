import { gsap } from "gsap";
import SplitType from "split-type";
import type { IntroMotion } from "@/components/home/home-intro";

// Cuts through the gaps of /images/logo.png (715x275), in percent: Z|E|U|S columns, then the ZEUS row above
// "AUTO DETAILING". Measured from the PNG's alpha on 2026-11-20; re-measure if the logo file changes.
const LETTER_CUTS = [0, 26.85, 49.37, 74.41, 100];
const ROW_CUT = 69.09;

// Fresh-tab opening on the shared HomeIntro curtain, a title card over the shop footage: the hero film fades up dark
// and drained of colour behind the mark, the four ZEUS letters rise one by one out of a mask, "AUTO DETAILING" wipes in
// and a soft light passes over the mark. As the letters lift away the colour comes back into the footage while the
// camera pushes in, the black settles into widescreen film bars around the hero, then the bars leave the frame.
// The letter slices and film bars are built here, on the client, so the shared HomeIntro markup (homepage) stays untouched.
export const playLandingIntro: IntroMotion = (root, finish) => {
  const curtain = root.querySelector<HTMLElement>("[data-home-curtain]")!;
  const mark = curtain.querySelector<HTMLElement>(".zeus-intro__mark")!;
  const img = mark.querySelector<HTMLImageElement>("img")!;
  const line = mark.querySelector("[data-intro-line]");
  const bars = ["top", "bottom"].map((side) => {
    const bar = document.createElement("div");
    bar.className = "zeus-intro__bar";
    bar.dataset.side = side;
    curtain.append(bar);
    return bar;
  });
  const logo = document.createElement("div");
  logo.className = "zeus-intro__logo";
  const piece = (clip: string) => {
    const slot = document.createElement("div");
    slot.className = "zeus-intro__slice";
    slot.style.clipPath = clip;
    const copy = img.cloneNode() as HTMLImageElement;
    slot.append(copy);
    logo.append(slot);
    return copy;
  };
  const letters = LETTER_CUTS.slice(1).map((right, i) => {
    const copy = piece(`inset(0 ${100 - right}% ${100 - ROW_CUT}% ${LETTER_CUTS[i]}%)`);
    // The copy moves inside its slot, so it carries only the ZEUS row; otherwise "AUTO DETAILING" slides through.
    copy.style.clipPath = `inset(0 0 ${100 - ROW_CUT}% 0)`;
    return copy;
  });
  const subline = piece(`inset(${ROW_CUT}% 0 0 0)`);
  const shine = document.createElement("div");
  shine.className = "zeus-intro__shine";
  shine.style.setProperty("--logo", `url("${img.getAttribute("src")}")`);
  logo.append(shine);
  img.before(logo);
  img.hidden = true;
  const split = new SplitType(mark.querySelector<HTMLElement>("[data-intro-text]")!, { types: "words" });
  const hero = root.querySelector<HTMLElement>(".landing-hero");
  // Widescreen 2.39:1 frame on wide screens; bars stay between 9% and 17% of the height so a tall phone keeps a usable frame.
  const filmBar = Math.min(innerHeight * .17, Math.max(innerHeight * .09, (innerHeight - innerWidth / 2.39) / 2));
  const timeline = gsap.timeline({ onComplete: finish, defaults: { ease: "power3.out" } });
  const restore = () => { timeline.revert(); split.revert(); logo.remove(); bars.forEach((bar) => bar.remove()); img.hidden = false; };
  try {
    // The curtain thins to a dim veil so the footage shows behind the mark, then clears as the film bars slide in.
    timeline.fromTo(curtain, { backgroundColor: "rgba(0,0,0,1)" }, { backgroundColor: "rgba(0,0,0,.62)", duration: 1.4, ease: "power2.inOut" }, 0)
      .fromTo(bars, { height: 0 }, { height: filmBar, duration: 1, ease: "power4.inOut" }, 2.45)
      .to(curtain, { backgroundColor: "rgba(0,0,0,0)", duration: 1, ease: "power2.inOut" }, 2.45)
      .fromTo(logo, { scale: 1.04 }, { scale: 1, duration: 2.4, ease: "power2.out" }, 0)
      .from(line, { scaleX: 0, duration: 1, ease: "power4.inOut" }, .1)
      .fromTo(letters, { yPercent: 100 }, { yPercent: 0, duration: 1.05, stagger: .1, ease: "power4.out" }, .4)
      .fromTo(subline, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: .85, ease: "power3.inOut" }, .95)
      .fromTo(shine, { backgroundPosition: "130% 0" }, { backgroundPosition: "-30% 0", duration: 1.2, ease: "power2.inOut" }, 1.2)
      .from(split.words, { opacity: 0, yPercent: 70, stagger: .06, duration: .7 }, 1.35)
      .to(letters, { yPercent: -100, duration: .5, stagger: .05, ease: "power3.in" }, 2.2)
      .to([subline, line, mark.querySelector("[data-intro-text]")], { opacity: 0, y: -12, duration: .4, ease: "power2.in" }, 2.25)
      .to(bars[0], { yPercent: -100, duration: .8, ease: "power3.inOut" }, 3.45)
      .to(bars[1], { yPercent: 100, duration: .8, ease: "power3.inOut" }, 3.45);
    const frame = hero?.querySelector(".landing-video-frame");
    if (hero && frame) {
      // Ends by ~4.25s, inside HomeIntro's 5.5s watchdog. The footage drifts in black and white under the title, then
      // the colour grade comes up as the camera settles.
      timeline.fromTo(frame, { scale: 1.14, filter: "grayscale(1) brightness(.75)" }, { scale: 1.07, duration: 2.45, ease: "none" }, 0)
        .to(frame, { filter: "grayscale(0) brightness(1)", duration: 1.2, ease: "power2.inOut" }, 2.4)
        .to(frame, { scale: 1, duration: 1.6, ease: "power3.out" }, 2.45)
        .fromTo(hero.querySelectorAll(".landing-hero-line > span"), { yPercent: 100 }, { yPercent: 0, duration: .9, stagger: .09, ease: "power4.out" }, 2.85)
        .from([root.querySelector(".landing-header"), hero.querySelector(".landing-scroll-cue"), hero.querySelector(".landing-hero-bar")], { opacity: 0, y: 14, duration: .7, stagger: .08 }, 3.5);
    }
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
};
