// Customer view of availability (T-039 "Public availability boundary", ARCHITECTURE.md).
// Customers see a time as Available, Fully booked or not bookable for a fixed reason: never a
// bay count, capacity or staff-entered text. This is the wizard's only reader of slot state.
//
// Until T-014 ships PublicSlot from GET /api/availability, the wire still carries engine slots.
// The mapping below mirrors the published toPublicSlot (customer cutoff 0 for new bookings).
// When the contract types land in src/types/contracts.ts, import PublicSlot/PublicSlotState from
// there and make toPublicSlot accept the server's PublicSlot unchanged.
import type { AvailableSlot, AvailableSlotData, DayState } from "@/types/contracts";

export type PublicSlotState =
  | "AVAILABLE" | "FULLY_BOOKED" | "PAST" | "TOO_SOON" | "ENDS_AFTER_CLOSING" | "SHOP_CLOSED";

export interface PublicSlot {
  date: string;
  startTime: string;
  endTime: string;
  state: PublicSlotState;
  selectable: boolean;
  message: string | null;
}

const PUBLIC_SLOT_MESSAGES: Readonly<Record<PublicSlotState, string | null>> = {
  AVAILABLE: null,
  FULLY_BOOKED: "Fully booked",
  PAST: "This time has passed",
  TOO_SOON: "Too soon to change online",
  ENDS_AFTER_CLOSING: "Ends after closing time",
  SHOP_CLOSED: "Shop closed at this time",
};

const PUBLIC_DAY_MESSAGES: Readonly<Record<DayState, string | null>> = {
  OPEN: null,
  HOLIDAY: "We're closed on this date",
  CLOSED: "We're closed on this day",
};

function publicStateOf(slot: AvailableSlot): PublicSlotState {
  switch (slot.state) {
    case "PAST": return "PAST";
    case "OUTSIDE_HOURS": return "ENDS_AFTER_CLOSING";
    case "BLOCKED": case "HOLIDAY": case "CLOSED": return "SHOP_CLOSED";
    case "SOLD_OUT": return "FULLY_BOOKED";
    case "LIMITED": case "AVAILABLE": return "AVAILABLE";
  }
}

// Builds a fresh object from named fields so capacity, slotId and reason can never pass through.
export function toPublicSlot(slot: AvailableSlot): PublicSlot {
  const state = publicStateOf(slot);
  return {
    date: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    state,
    selectable: state === "AVAILABLE",
    message: PUBLIC_SLOT_MESSAGES[state],
  };
}

export function slotLabel(slot: PublicSlot): string {
  if (slot.state === "AVAILABLE") return "Available";
  return slot.message ?? "Not available";
}

// Fixed day wording; the engine's day reason may hold staff-entered block text.
export function publicDayMessage(data: Pick<AvailableSlotData, "dayState">): string | null {
  return PUBLIC_DAY_MESSAGES[data.dayState];
}
