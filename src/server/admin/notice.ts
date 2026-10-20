import "server-only";
import { sendTurnNotice } from "@/server/notifications/bookings";

// "Your turn is coming" (ADR-005 §18). P1-03 owns the email send; P1-07 codes against this
// interface (PM decision D2) and the integrator wires P1-03's function in. Until then the
// default reports NOT_SENT, so staff see the truth instead of a false "sent".
export interface TurnNoticeSender { send(bookingId: string): Promise<"SENT" | "NOT_SENT"> }
export const unavailableSender: TurnNoticeSender = { async send() { return "NOT_SENT"; } };

// P1-03 owns delivery; P1-07 owns authorization, attempt audit and limits.
export function bookingTurnNoticeSender(options: Parameters<typeof sendTurnNotice>[1] = {}): TurnNoticeSender {
  return { send: (bookingId) => sendTurnNotice(bookingId, options) };
}
