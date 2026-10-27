// P1-19 W1/W7: a newly shown step, panel or result opens at its top with focus on its heading
// (WCAG 2.4.3), so a phone never lands part-way down a page. The target needs tabIndex={-1}.
export function reveal(id: string) {
  if (typeof document === "undefined") return;
  const target = document.getElementById(id);
  if (!target) return;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  target.focus({ preventScroll: true });
}
