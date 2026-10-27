// P1-19 W1/W7: a newly shown step, panel or result opens at its top with focus on its heading
// (WCAG 2.4.3), so a phone never lands part-way down a page. The target needs tabIndex={-1}.
// The jump is instant, like a new page: a smooth scroll was cut short in the browser while the
// step's content (day list, price) was still arriving.
export function reveal(id: string) {
  if (typeof document === "undefined") return;
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ block: "start", behavior: "instant" });
  target.focus({ preventScroll: true });
}
