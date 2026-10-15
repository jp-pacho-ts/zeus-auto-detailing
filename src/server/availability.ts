import "server-only";
import { Prisma } from "@prisma/client";
import { GetAvailableSlotsSchema } from "@/lib/validation";
import type { AvailableSlotResponse, GetAvailableSlotsRequest } from "@/types/contracts";
import { prisma } from "./db";
import { readAvailability } from "./availability-data";
import { contractError, validationError } from "./errors";

export async function getAvailableSlots(params: GetAvailableSlotsRequest): Promise<AvailableSlotResponse> {
  const parsed = GetAvailableSlotsSchema.safeParse(params);
  if (!parsed.success) return { ok: false, error: validationError(parsed.error.issues) };
  try {
    const data = await prisma.$transaction(async tx => (await readAvailability(tx, parsed.data)).data, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 });
    return { ok: true, data };
  } catch (error) { return { ok: false, error: contractError(error) }; }
}
