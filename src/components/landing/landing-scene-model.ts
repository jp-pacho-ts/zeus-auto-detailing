// Layout-space positions avoid feedback from the cards' animated perspective transforms.
export function careTrackRange(viewport: number, card: number, track: number) {
  const start = (viewport - card) / 2;
  return { start, end: start - Math.max(0, track - card) };
}
export function careFocusProgress(index: number, count: number) {
  return count > 1 ? Math.max(0, Math.min(1, index / (count - 1))) : 0;
}
