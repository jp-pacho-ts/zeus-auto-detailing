import "server-only";

// Structured admin events (T-019 audit trail rules): ids, actor, action, revisions and error
// codes only. Never customer fields, reasons, search terms, cursors, digests or keys.
export type AdminEventSink = (event: string, fields: Record<string, string | number | boolean | null>) => void;
let sink: AdminEventSink = (event, fields) => console.info(JSON.stringify({ event, ...fields }));
export function setAdminEventSink(next: AdminEventSink): void { sink = next; }
export function adminEvent(event: string, fields: Record<string, string | number | boolean | null> = {}): void { sink(event, fields); }
