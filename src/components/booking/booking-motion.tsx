"use client";
// The booking stage's motion, in the landing's language. Three pointer effects adapted from React Bits by David Haz
// (SpotlightCard, Magnet, CountUp; see src/components/landing/react-bits-magnet.LICENSE), plus the landing's Lenis
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
      // Magnet: the gold action leans toward a pointer that comes within 26 px, as the landing's Book button does.
      let frame = 0, pointer: { x: number; y: number } | null = null;
      const pulled = new Set<HTMLElement>();
      const update = () => {
        frame = 0;
        if (!pointer) return;
        const card = (document.elementFromPoint(pointer.x, pointer.y) as Element | null)?.closest<HTMLElement>(CARDS);
        if (card && stage.contains(card)) {
          const box = card.getBoundingClientRect();
          card.style.setProperty("--spot-x", `${pointer.x - box.left}px`);
          card.style.setProperty("--spot-y", `${pointer.y - box.top}px`);
        }
        stage.querySelectorAll<HTMLButtonElement>('[data-part="primary"]').forEach((button) => {
          const box = button.getBoundingClientRect();
          const dx = pointer!.x - (box.left + box.width / 2), dy = pointer!.y - (box.top + box.height / 2);
          const outside = Math.hypot(Math.max(0, Math.abs(dx) - box.width / 2), Math.max(0, Math.abs(dy) - box.height / 2));
          const near = box.width > 0 && !button.disabled && outside <= 26 && !button.matches(":focus-visible");
          if (near) {
            pulled.add(button);
            const clamp = (v: number) => Math.max(-8, Math.min(8, v / 3));
            gsap.to(button, { x: clamp(dx), y: clamp(dy), scale: 1.02, duration: .45, ease: "power3.out", overwrite: "auto" });
          } else if (pulled.delete(button)) {
            gsap.to(button, { x: 0, y: 0, scale: 1, duration: .8, ease: "elastic.out(1, .45)", overwrite: "auto" });
          }
        });
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
        pulled.forEach((button) => gsap.set(button, { clearProps: "transform" }));
      };
    });

    // The online menu's floating preview (the hover image reveal of editorial menus): over a size row the size's gold
    // drawing, over a service row its photo, follow the pointer with a little lag and lean with its speed. The rows
    // keep their own pictures for touch screens and reduced motion (the CSS hides them only where this runs).
    media.add("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)", () => {
      const float = document.createElement("div");
      float.dataset.part = "float";
      float.setAttribute("aria-hidden", "true");
      stage.append(float);
      gsap.set(float, { autoAlpha: 0, scale: .7, yPercent: -50 });
      const xTo = gsap.quickTo(float, "x", { duration: .55, ease: "power3" });
      const yTo = gsap.quickTo(float, "y", { duration: .55, ease: "power3" });
      const lean = gsap.quickTo(float, "rotation", { duration: .6, ease: "power3" });
      let current: HTMLElement | null = null, lastX = 0, upright: gsap.core.Tween | null = null;
      const show = (row: HTMLElement) => {
        if (row === current) return;
        current = row;
        const photo = row.dataset.photo, drawing = row.querySelector('[data-part="vehicle-mark"] svg');
        if (photo) {
          const img = document.createElement("img");
          img.src = photo;
          img.alt = "";
          float.replaceChildren(img);
        } else if (drawing) float.replaceChildren(drawing.cloneNode(true));
        else return hide();
        float.dataset.kind = photo ? "photo" : "drawing";
        gsap.to(float, { autoAlpha: 1, scale: 1, duration: .5, ease: "power3.out", overwrite: "auto" });
      };
      const hide = () => {
        current = null;
        gsap.to(float, { autoAlpha: 0, scale: .7, duration: .3, ease: "power2.in", overwrite: "auto" });
      };
      const move = (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        // Beside the pointer, on the side with room, so it never covers the name being read.
        const right = event.clientX < innerWidth * .62;
        gsap.set(float, { xPercent: right ? 0 : -100 });
        xTo(event.clientX + (right ? 36 : -36));
        yTo(event.clientY);
        lean(Math.max(-8, Math.min(8, (event.clientX - lastX) * .6)));
        lastX = event.clientX;
        upright?.kill();
        upright = gsap.delayedCall(.12, () => lean(0));
        const row = (event.target as Element | null)?.closest?.<HTMLElement>(`[data-layout="online"] :is(${CARDS})`);
        if (row && stage.contains(row)) show(row);
        else if (current) hide();
      };
      window.addEventListener("pointermove", move, { passive: true });
      document.documentElement.addEventListener("pointerleave", hide);
      return () => {
        window.removeEventListener("pointermove", move);
        document.documentElement.removeEventListener("pointerleave", hide);
        upright?.kill();
        float.remove();
      };
    });

    // Lenis, as on the landing: wheel scrolling glides on laptops and desktops; touch scrolling stays native.
    media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference) and (pointer: fine)", () => {
      const lenis = new Lenis({ duration: .85, smoothWheel: true, syncTouch: false, allowNestedScroll: true, prevent: (node) => !!node.closest("dialog, select") });
      // The wizard jumps to each new step's heading and brings focused fields into view; Lenis takes that position over.
      const settle = () => lenis.scrollTo(window.scrollY, { immediate: true, force: true });
      stage.addEventListener("focusin", settle);
      return () => { stage.removeEventListener("focusin", settle); lenis.destroy(); };
    });
    return () => media.revert();
  }, []);
  return <span ref={marker} hidden />;
}
