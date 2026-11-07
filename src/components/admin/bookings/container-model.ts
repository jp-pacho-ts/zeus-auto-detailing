// P1-62: the container rules that need no database or React. A container is a named group of bays; any car can go in any empty active bay
// (LE 2026-11-07). The optional "usually for" label only drives a question that never blocks.

const QUEUE_WORDS: Record<string, string> = {
  WASH: "Wash",
  DETAILING_COATING: "Detailing and coating",
  TINT_PPF: "Tint and PPF",
  REPAINT: "Repaint",
};
/** The plain words for a queue code; an unknown code is shown as it is. */
export const queueLabel = (code: string): string => QUEUE_WORDS[code] ?? code;

function joinWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
/** Under the container name: what it is usually for, in plain words. */
export const usualForLine = (usualQueues: string[]): string => (usualQueues.length === 0 ? "No usual service" : `Usually for ${joinWords(usualQueues.map(queueLabel))}`);

/**
 * "Place it anyway?": asked only when the container has a label and the car's main service is not in it. A container with no label never
 * asks. The answer never blocks and never changes the booking's queue or any limit. Null means no question.
 */
export function placementPrompt(car: { queueCode: string; queueName: string }, container: { name: string; usualQueues: string[] }): string | null {
  if (container.usualQueues.length === 0 || container.usualQueues.includes(car.queueCode)) return null;
  return `This car is a ${queueLabel(car.queueCode)} car and ${container.name} is usually for ${joinWords(container.usualQueues.map(queueLabel))}. Place it anyway?`;
}

/** Any car may go in any empty active bay. The kind of bay no longer matters. */
export const canPlace = (bay: { isActive: boolean; cards: unknown[] }): boolean => bay.isActive && bay.cards.length === 0;

/** The tag on a Waiting card: the main service, and "+ n more" for the other services of the booking. */
export function waitingTag(card: { queueName: string; lines: unknown[] }): string {
  const more = Math.max(0, card.lines.length - 1);
  return more === 0 ? card.queueName : `${card.queueName} + ${more} more`;
}
