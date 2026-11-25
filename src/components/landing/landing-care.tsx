"use client";
import { useState, type MouseEvent, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

export type CareItem = { title: string; text: string; href: string; cta: string; photo: ReactNode };

// LE 2026-11-20 service selector (refs: the Koenigsegg, Porsche and Rolls-Royce model pickers): one panel open at a
// time in full colour, the others folded into dark strips with a vertical title. Hover or focus opens a panel and it
// stays open; on a touch screen the first tap opens a folded panel and the second follows the link. Phones get
// stacked cards (CSS), where every panel is open.
export function LandingCare({ items }: { items: CareItem[] }) {
  const [active, setActive] = useState(0);
  const tapToOpen = (i: number) => (event: MouseEvent) => {
    if (i !== active && matchMedia("(hover: none) and (min-width: 901px)").matches) { event.preventDefault(); setActive(i); }
  };
  return <div className="landing-care-grid">{items.map((item, i) => (
    <a className="landing-care-card" href={item.href} key={item.href} data-active={i === active}
      onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={tapToOpen(i)}>
      <div className="landing-care-photo">{item.photo}</div>
      <span className="landing-care-index" aria-hidden="true">0{i + 1}</span>
      <span className="landing-care-spine" aria-hidden="true">{item.title}</span>
      <div className="landing-care-content">
        <h3>{item.title}</h3>
        <p>{item.text}</p>
        <span>{item.cta}<ArrowUpRight aria-hidden="true" /></span>
      </div>
    </a>
  ))}</div>;
}
