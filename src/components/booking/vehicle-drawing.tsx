// P1-52: side-view outlines for the five vehicle sizes, drawn inline (no image file, no new dependency).
// Decorative: the size's name and description sit beside it, so the drawing is hidden from screen readers.
const WHEEL = "fill-card";

function Body({ code }: { code: string }) {
  switch (code) {
    case "MOTOR":
      return (
        <>
          <circle cx="28" cy="42" r="12" />
          <circle cx="92" cy="42" r="12" />
          <path d="M28 42 50 26h20l22 16M50 26l-6-10 12-3M70 26l8-10h10" />
        </>
      );
    case "M":
      return (
        <>
          <path d="M6 38v-7q0-4 6-5l16-2q6-14 24-14h26q12 1 18 14l12 3q6 2 6 8v3z" />
          <circle cx="32" cy="38" r="8" className={WHEEL} />
          <circle cx="90" cy="38" r="8" className={WHEEL} />
        </>
      );
    case "L":
      return (
        <>
          <path d="M6 38V28q0-4 6-5l10-1 8-12h46q8 0 14 12l10 3q6 2 6 8v5z" />
          <circle cx="30" cy="38" r="9" className={WHEEL} />
          <circle cx="90" cy="38" r="9" className={WHEEL} />
        </>
      );
    case "XL":
      return (
        <>
          <path d="M6 38V16q0-6 6-6h66l18 14 14 3q4 2 4 7v4z" />
          <circle cx="30" cy="38" r="9" className={WHEEL} />
          <circle cx="92" cy="38" r="9" className={WHEEL} />
        </>
      );
    default:
      return (
        <>
          <path d="M8 38v-6q0-4 6-5l16-2q8-13 24-13h18q12 1 20 13l14 3q6 2 6 8v2z" />
          <circle cx="32" cy="38" r="8" className={WHEEL} />
          <circle cx="88" cy="38" r="8" className={WHEEL} />
        </>
      );
  }
}

export function VehicleDrawing({ code, className = "" }: { code: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 120 54"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <Body code={code} />
    </svg>
  );
}
