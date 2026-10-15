"use server";

import { headers } from "next/headers";
import type { BookingResponse } from "@/types/contracts";
import { reserveBooking } from "@/server/bookings";
import { rateLimit } from "@/server/http";
import { contractError } from "@/server/errors";

export async function createBookingAction(input: unknown): Promise<BookingResponse> {
  try {
    rateLimit(await headers(), "booking", 15);
    return await reserveBooking(input);
  } catch (error) { return { ok: false, error: contractError(error) }; }
}
