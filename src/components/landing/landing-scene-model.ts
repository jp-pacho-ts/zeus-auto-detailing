export function careFocusProgress(index: number, count: number) {
  return count > 1 ? Math.max(0, Math.min(1, index / (count - 1))) : 0;
}

// Keep each shot fully open briefly between wipes.
export function careShotWindow(index: number, count: number) {
  const center = careFocusProgress(index, count);
  const halfHold = count > 1 ? .16 / (count - 1) : 0;
  return { start: Math.max(0, center - halfHold), end: Math.min(1, center + halfHold) };
}


export function careShotIndexAtProgress(progress: number, count: number) {
  return Math.round(Math.max(0, Math.min(1, progress)) * Math.max(0, count - 1));
}
