import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { UserRole } from "@/types/contracts";
import type { StaffTx } from "@/server/auth/db-admission";
import { AdminServiceError, zodError } from "./errors";
import { canPerform, type AdminOp } from "./roles";
import type { HistoryKeyRing } from "./history-key-ring";
import type { TurnNoticeSender } from "./notice";

// The verified caller, from the P1-06 session (route handlers) or a test.
export interface StaffActor { staffId: string; role: UserRole; sessionId: string }
export interface AdminOptions {
  db?: PrismaClient;
  now?: () => Date;
  signal?: AbortSignal;
  sender?: TurnNoticeSender; // W15 (D2): wired to P1-03's send at integration
  ring?: HistoryKeyRing | null; // W16; default: the process ring, validated on first use
}

export function authorize(actor: StaffActor, op: AdminOp): void {
  if (!canPerform(op, actor.role)) throw new AdminServiceError("FORBIDDEN");
}

export function parse<T>(schema: { safeParse(x: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw zodError(r.error.issues);
  return r.data;
}

// Asia/Manila is UTC+8 with no DST.
export const manilaDate = (at: Date): string => new Date(at.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
export const dateCarrier = (day: string): Date => new Date(day + "T00:00:00.000Z"); // @db.Date
export const dayStart = (day: string): Date => new Date(Date.parse(day + "T00:00:00.000+08:00"));
export const dayEnd = (day: string): Date => new Date(dayStart(day).getTime() + 86_400_000);
export const addDays = (day: string, n: number): string => new Date(Date.parse(day + "T00:00:00.000Z") + n * 86_400_000).toISOString().slice(0, 10);
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

// ADR-005 §10 / PM decision D3: every booking writer takes the shop lock first.
export const lockShop = (tx: StaffTx) => tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001, 1)");
