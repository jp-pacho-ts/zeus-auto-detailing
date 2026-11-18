// Layout-space positions avoid feedback from the cards' animated perspective transforms.
export function careTrackRange(viewport: number, card: number, track: number) {
  const start = (viewport - card) / 2;
  return { start, end: start - Math.max(0, track - card) };
}
export function careFocusProgress(index: number, count: number) {
  return count > 1 ? Math.max(0, Math.min(1, index / (count - 1))) : 0;
}

// Reserve a short range of scroll for the camera to move while the frame stays centered.
export function careShotWindow(index: number, count: number) {
  const center = careFocusProgress(index, count);
  const halfHold = count > 1 ? .16 / (count - 1) : 0;
  return { start: Math.max(0, center - halfHold), end: Math.min(1, center + halfHold) };
}
