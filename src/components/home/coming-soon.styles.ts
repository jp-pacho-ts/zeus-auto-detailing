// Page-local selectors and keyframes. Text is readable from the very first frame.
export const comingSoonStyles = `
.zeus-coming-soon {
  min-height: 100svh; display: flex; flex-direction: column; justify-content: space-between;
  gap: clamp(3rem, 7vh, 6rem); padding: clamp(1.5rem, 4.5vw, 4.5rem);
  max-width: 100rem; margin-inline: auto;
  background: rgb(var(--background)); color: rgb(var(--foreground));
}
.zeus-coming-soon__brand { padding-top: clamp(1rem, 5vh, 4rem); max-width: 68rem; transform-origin: left center; }
.zeus-coming-soon__logo { display: block; width: 100%; height: auto; }
.zeus-coming-soon__notice {
  display: grid; grid-template-columns: 1.2fr 1fr; align-items: end; gap: clamp(2rem, 5vw, 6rem);
}
.zeus-coming-soon h1 {
  margin: 0; font-size: clamp(2.25rem, 4.5vw, 4.5rem); line-height: 1.08;
  font-weight: 600; letter-spacing: -.035em;
}
.zeus-coming-soon h1 span { display: block; }
.zeus-coming-soon__contact { max-width: 29rem; }
.zeus-coming-soon p { margin: 0; font-size: 1.125rem; line-height: 1.6; }
.zeus-coming-soon a { -webkit-tap-highlight-color: transparent; }
.zeus-coming-soon__call {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  margin-top: 1.75rem; padding: 1rem 1.25rem; min-height: 3.5rem;
  background: rgb(var(--primary)); color: rgb(var(--primary-foreground));
  font-size: 1rem; font-weight: 600; text-decoration: none;
  transition: background-color 180ms ease, transform 180ms ease;
}
.zeus-coming-soon__call svg { flex-shrink: 0; }
.zeus-coming-soon__phone { display: block; font-variant-numeric: tabular-nums; }
.zeus-coming-soon__call:hover { background: rgb(var(--primary-hover)); }
.zeus-coming-soon__call:active { transform: translateY(2px); }
.zeus-coming-soon a:focus-visible { outline: 3px solid rgb(var(--foreground)); outline-offset: 5px; }
.zeus-coming-soon__footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem 2rem; }
.zeus-coming-soon__footer p { font-size: 1rem; }
.zeus-coming-soon__footer a {
  display: inline-flex; align-items: center; gap: .5rem; min-height: 2.75rem;
  font-size: 1rem; text-decoration: underline; text-underline-offset: .3em; text-decoration-thickness: 1px;
}
.zeus-coming-soon__footer a:hover { color: rgb(var(--primary-hover)); }
.zeus-coming-soon ::selection { background: rgb(var(--primary)); color: rgb(var(--primary-foreground)); }
@media (prefers-reduced-motion: no-preference) {
  .zeus-coming-soon__brand { animation: zeus-brand-settle 1100ms cubic-bezier(.16,1,.3,1) both; }
  @keyframes zeus-brand-settle {
    from { transform: translateY(1.5rem) scale(.96); }
    to { transform: translateY(0) scale(1); }
  }
}
@media (max-width: 767px) {
  .zeus-coming-soon { gap: 3rem; padding: 1.5rem; }
  .zeus-coming-soon__brand { padding-top: 2.5rem; }
  .zeus-coming-soon__notice { grid-template-columns: 1fr; gap: 1.75rem; }
  .zeus-coming-soon h1 { font-size: clamp(1.75rem, 7.5vw, 3.5rem); }
  .zeus-coming-soon__contact { max-width: none; }
  .zeus-coming-soon__footer { align-items: start; flex-direction: column; gap: .5rem; }
}
@media (prefers-reduced-motion: reduce) {
  .zeus-coming-soon__brand { animation: none; transform: none; }
  .zeus-coming-soon__call { transition: none; }
  .zeus-coming-soon__call:active { transform: none; }
}
`;
