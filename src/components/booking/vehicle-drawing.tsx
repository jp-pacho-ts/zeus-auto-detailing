// P1-52 (LE 2026-11-06, mock F "gold extruded 3D"): the five vehicle sizes as gold, extruded icons, drawn inline (no image file, no
// package). The shapes are Phosphor Icons, "fill" weight, copied here as SVG paths: https://phosphoricons.com
// Phosphor Icons, Copyright (c) 2020 Phosphor Icons, MIT License (permission to use, copy, modify and distribute is granted, provided
// this notice stays with the copied paths). Source: @phosphor-icons/core 2.1.1, assets/fill/<name>-fill.svg.
// Look: the Zeus gold gradient on the face (one shared gradient, defined once per page by <VehicleDrawingDefs />), seven darker copies
// stacked down and to the right for the extrusion, and a soft drop shadow. Decorative: the size's name and description are the label.
const PATHS: Record<string, string> = {
  // motorcycle
  MOTOR:
    "M216,120a41,41,0,0,0-6.6.55l-5.82-15.14A55.64,55.64,0,0,1,216,104a8,8,0,0,0,0-16H196.88L183.47,53.13A8,8,0,0,0,176,48H144a8,8,0,0,0,0,16h26.51l9.23,24H152c-18.5,0-33.5,4.31-43.37,12.46a16,16,0,0,1-16.76,2.07c-10.58-4.81-73.29-30.12-73.8-30.26a8,8,0,0,0-5,15.19S68.57,109.4,79.6,120.4A55.67,55.67,0,0,1,95.43,152H79.2a40,40,0,1,0,0,16h52.12a31.91,31.91,0,0,0,30.74-23.1,56,56,0,0,1,26.59-33.72l5.82,15.13A40,40,0,1,0,216,120ZM40,168H62.62a24,24,0,1,1,0-16H40a8,8,0,0,0,0,16Zm176,16a24,24,0,0,1-15.58-42.23l8.11,21.1a8,8,0,1,0,14.94-5.74L215.35,136l.65,0a24,24,0,0,1,0,48Z",
  // car-simple
  S: "M240,104H229.2L201.42,41.5A16,16,0,0,0,186.8,32H69.2a16,16,0,0,0-14.62,9.5L26.8,104H16a8,8,0,0,0,0,16h8v80a16,16,0,0,0,16,16H64a16,16,0,0,0,16-16v-8h96v8a16,16,0,0,0,16,16h24a16,16,0,0,0,16-16V120h8a8,8,0,0,0,0-16ZM44.31,104,69.2,48H186.8l24.89,56Z",
  // car-profile
  M: "M240,112H211.31L168,68.69A15.86,15.86,0,0,0,156.69,64H44.28A16,16,0,0,0,31,71.12L1.34,115.56A8.07,8.07,0,0,0,0,120v48a16,16,0,0,0,16,16H33a32,32,0,0,0,62,0h66a32,32,0,0,0,62,0h17a16,16,0,0,0,16-16V128A16,16,0,0,0,240,112ZM44.28,80H156.69l32,32H23ZM64,192a16,16,0,1,1,16-16A16,16,0,0,1,64,192Zm128,0a16,16,0,1,1,16-16A16,16,0,0,1,192,192Z",
  // jeep
  L: "M248,103.47A8.17,8.17,0,0,0,239.73,96H232a8,8,0,0,0-.18-1.68L221.18,44.65A16.08,16.08,0,0,0,205.53,32H50.47A16.08,16.08,0,0,0,34.82,44.65L24.18,94.32A8,8,0,0,0,24,96H16.27A8.17,8.17,0,0,0,8,103.47,8,8,0,0,0,16,112h8v88a16,16,0,0,0,16,16H64a16,16,0,0,0,16-16V184h20a4,4,0,0,0,4-4V128.27a8.17,8.17,0,0,1,7.47-8.25,8,8,0,0,1,8.53,8v52a4,4,0,0,0,4,4h8a4,4,0,0,0,4-4V128.27a8.17,8.17,0,0,1,7.47-8.25,8,8,0,0,1,8.53,8v52a4,4,0,0,0,4,4h20v16a16,16,0,0,0,16,16h24a16,16,0,0,0,16-16V112h8A8,8,0,0,0,248,103.47ZM68,144a12,12,0,1,1,12-12A12,12,0,0,1,68,144Zm120,0a12,12,0,1,1,12-12A12,12,0,0,1,188,144ZM40.18,96,50.47,48H205.53l10.29,48Z",
  // van
  XL: "M254.07,106.79,208.53,53.73A16,16,0,0,0,196.26,48H32A16,16,0,0,0,16,64V176a16,16,0,0,0,16,16H49a32,32,0,0,0,62,0h50a32,32,0,0,0,62,0h17a16,16,0,0,0,16-16V112A8,8,0,0,0,254.07,106.79ZM32,104V64H88v40Zm48,96a16,16,0,1,1,16-16A16,16,0,0,1,80,200Zm80-96H104V64h56Zm32,96a16,16,0,1,1,16-16A16,16,0,0,1,192,200Zm-16-96V64h20.26l34.33,40Z",
};

export const GOLD_GRADIENT_ID = "zeus-gold-3d";
// The face gradient (top to bottom) and the seven extrusion shades (nearest to the face first), defined once here.
const GOLD_STOPS: [string, string][] = [
  ["0", "#fbe3a0"],
  ["0.38", "#e8b44a"],
  ["0.72", "#c58b1b"],
  ["1", "#8a5a0b"],
];
const EXTRUSION = ["#a57011", "#94640f", "#82570d", "#704a0b", "#5e3d09", "#4d3207", "#3d2705"];
const STEP = 1.6; // viewBox units (of 256) between two extrusion layers, down and to the right

// Rendered once on the page that shows drawings (not once per tile): the gradient every drawing's face points at.
export function VehicleDrawingDefs() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        <linearGradient id={GOLD_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
          {GOLD_STOPS.map(([offset, color]) => (
            <stop key={offset} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
    </svg>
  );
}

export function VehicleDrawing({ code, className = "" }: { code: string; className?: string }) {
  const d = PATHS[code] ?? PATHS.S;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 256 256"
      overflow="visible"
      className={className}
      style={{ filter: "drop-shadow(0 4px 3px rgba(0, 0, 0, 0.6))" }}
    >
      {/* The farthest layer first, so each nearer one paints over it. */}
      {[...EXTRUSION].reverse().map((shade, index) => {
        const offset = ((EXTRUSION.length - index) * STEP).toFixed(1);
        return <path key={shade} d={d} fill={shade} transform={`translate(${offset} ${offset})`} />;
      })}
      <path d={d} fill={`url(#${GOLD_GRADIENT_ID})`} />
    </svg>
  );
}
