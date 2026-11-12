import "server-only";
import { sendTurnNotice } from "@/server/notifications/bookings";
import type { NoticeFailure } from "@/types/admin-contracts";

// "Your turn is coming" (ADR-005 §18). P1-03 owns the email send; P1-07 codes against this
// interface (PM decision D2) and the integrator wires P1-03's function in. Until then the
// default reports NOT_SENT, so staff see the truth instead of a false "sent".
export type NoticeType = "turn" | "reminder" | "confirmation";

export interface TurnNoticeSender {
  send(bookingId: string, type?: NoticeType): Promise<"SENT" | "NOT_SENT" | NoticeFailure>;
}
export const unavailableSender: TurnNoticeSender = { async send() { return "NOT_SENT"; } };

// P1-03 owns delivery; P1-07 owns authorization, attempt audit and limits.
export function bookingTurnNoticeSender(options: Parameters<typeof sendTurnNotice>[1] = {}): TurnNoticeSender {
  return { send: (bookingId, type = "turn") => sendTurnNotice(bookingId, options, type) };
}
