"use client";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

const subscribe = () => () => {};
// P1-90 strategy 9.2: only confirmed answers. Every answer is visible before hydration and without JS; after hydration each row is a disclosure.
export function LandingFaq({ items }: { items: { question: string; answer: ReactNode }[] }) {
  const enhanced = useSyncExternalStore(subscribe, () => true, () => false);
  const [open, setOpen] = useState<number | null>(null);
  return <section id="faq" className="landing-section landing-wrap" aria-labelledby="landing-faq-title">
    <h2 id="landing-faq-title">Questions before you book</h2>
    <div className="landing-faq">{items.map((item, i) => {
      const expanded = !enhanced || open === i;
      return <div className="landing-faq-item" key={item.question}>
        <h3><button type="button" className="landing-faq-question" aria-expanded={expanded} aria-controls={`landing-faq-${i}`} disabled={!enhanced} onClick={() => setOpen(open === i ? null : i)}>{item.question}{expanded ? <Minus aria-hidden="true" /> : <Plus aria-hidden="true" />}</button></h3>
        <div id={`landing-faq-${i}`} className="landing-faq-answer" role="region" aria-label={item.question} data-open={expanded}><div>{item.answer}</div></div>
      </div>;
    })}</div>
  </section>;
}
