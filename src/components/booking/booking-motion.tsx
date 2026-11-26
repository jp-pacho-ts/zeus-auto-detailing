"use client";
// The booking stage's motion, in the landing's language. Two effects adapted from React Bits by David Haz
// (SpotlightCard, CountUp; see src/components/landing/react-bits-magnet.LICENSE), plus the landing's Lenis
// smooth scroll. They are delegated from the stage, so the wizard's markup only carries data attributes. Nothing here
// runs with reduced motion, and the pointer effects and Lenis only run with a mouse or trackpad.
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

const CARDS = '[data-part="vehicle-card"], [data-part="menu-tile"]';
// The totals that roll: the order panel and the review mark theirs; the bar's total is its only <strong>.
const COUNTED = "[data-count], #wizard-action-bar strong";
const DIGITS = /\d[\d,]*(?:\.\d+)?/;
const amountOf = (text: string | null) => {
  const found = text?.match(DIGITS);
  return found ? Number(found[0].replace(/,/g, "")) : null;
};

export function BookingMotion() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const stage = marker.current?.closest<HTMLElement>("[data-booking-stage]");
    if (!stage) return;
    const media = gsap.matchMedia();

    // CountUp: when a price changes, it rolls from the old amount to the new one. The text node React owns is the one
    // that changes, and the last frame writes React's own string back, so React and the screen never disagree.
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const written = new WeakMap<Text, string>();
      const tweens = new WeakMap<Text, gsap.core.Tween>();
      const roll = (node: Text, from: number) => {
        const final = node.nodeValue ?? "";
        const to = amountOf(final);
        tweens.get(node)?.kill();
        if (to === null || from === to) return;
        const decimals = final.match(DIGITS)![0].split(".")[1]?.length ?? 0;
        const format = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
        const write = (text: string) => { written.set(node, text); node.nodeValue = text; };
        const value = { n: from };
        write(final.replace(DIGITS, format.format(from)));
        tweens.set(node, gsap.to(value, {
          n: to, duration: .7, ease: "power3.out",
          onUpdate: () => write(final.replace(DIGITS, format.format(value.n))),
          onComplete: () => write(final),
        }));
      };
      const counted = (node: Node) => node.parentElement?.closest(COUNTED) ? node : null;
      const watch = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "characterData") {
            const node = record.target as Text;
            // Our own frames come back here too; only React's change starts a roll, from what was on screen.
            if (counted(node) && node.nodeValue !== written.get(node)) roll(node, amountOf(record.oldValue) ?? 0);
            continue;
          }
          // A total that has just appeared (the first price, or the order panel opening) counts up from zero.
          record.addedNodes.forEach((added) => {
            const nodes = added.nodeType === Node.TEXT_NODE ? [added] : [...(added as Element).querySelectorAll?.(COUNTED) ?? [], ...((added as Element).matches?.(COUNTED) ? [added] : [])].flatMap((el) => [...el.childNodes]);
            nodes.forEach((node) => { if (node.nodeType === Node.TEXT_NODE && counted(node)) roll(node as Text, 0); });
          });
        }
      });
      watch.observe(stage, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
      return () => watch.disconnect();
    });

    media.add("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)", () => {
      // SpotlightCard: a soft gold light follows the pointer across the size and service cards (the CSS draws it).
      // (The Magnet pull on Continue was removed: the CEO did not like it moving. Hover only changes its colour.)
      let frame = 0, pointer: { x: number; y: number } | null = null;
      const update = () => {
        frame = 0;
        if (!pointer) return;
        const card = (document.elementFromPoint(pointer.x, pointer.y) as Element | null)?.closest<HTMLElement>(CARDS);
        if (card && stage.contains(card)) {
          const box = card.getBoundingClientRect();
          card.style.setProperty("--spot-x", `${pointer.x - box.left}px`);
          card.style.setProperty("--spot-y", `${pointer.y - box.top}px`);
        }
      };
      const move = (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        pointer = { x: event.clientX, y: event.clientY };
        frame ||= requestAnimationFrame(update);
      };
      const leave = () => { pointer = { x: -1e4, y: -1e4 }; frame ||= requestAnimationFrame(update); };
      window.addEventListener("pointermove", move, { passive: true });
      document.documentElement.addEventListener("pointerleave", leave);
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", move);
        document.documentElement.removeEventListener("pointerleave", leave);
      };
    });

    // Lenis, as on the landing: wheel scrolling glides on laptops and desktops; touch scrolling stays native.
    media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference) and (pointer: fine)", () => {
      // Driven by GSAP's ticker, as on the landing. Without a frame loop Lenis takes the wheel and never moves the page.
      const lenis = new Lenis({ duration: .85, smoothWheel: true, syncTouch: false, autoRaf: false, allowNestedScroll: true, prevent: (node) => !!node.closest("dialog, select") });
      const tick = (seconds: number) => lenis.raf(seconds * 1000);
      gsap.ticker.add(tick);
      // The wizard jumps to each new step's heading and brings focused fields into view; Lenis takes that position over.
      const settle = () => lenis.scrollTo(window.scrollY, { immediate: true, force: true });
      stage.addEventListener("focusin", settle);
      return () => { stage.removeEventListener("focusin", settle); gsap.ticker.remove(tick); lenis.destroy(); };
    });
    return () => media.revert();
  }, []);
  return <span ref={marker} hidden />;
}
