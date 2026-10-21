import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { AdminError, AdminWriteResult } from "@/types/admin-contracts";
import { AdminIdSchema, DepositStatusSchema } from "@/lib/admin-validation";
import { withStaffDb } from "@/server/auth/db-admission";
import { assertStaff, getStaffSessionFromRequest } from "@/server/auth/guards";
import { ADMIN_RESPONSE_HEADERS } from "@/server/auth/http";
import { asStaffAuthError } from "@/server/auth/errors";
import { authorize, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError } from "./errors";
import { adminEvent } from "./log";
import { audit, bump, conflict, detailOrThrow, loadForWrite, mutate } from "./mutation";

// P1-18 deposit decisions and proof reads. ADMIN alone marks a deposit RECEIVED or REJECTED:
// revision first, one audit row per change (its reason is staff-only), 409 with currentBooking.
// RECEIVED needs no proof (paid at the shop); REJECTED needs one. STAFF and ADMIN read proofs.
export async function setDepositStatus(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminWriteResult> {
  authorize(actor, "DEPOSIT_STATUS");
  const bookingId = parse(AdminIdSchema, id), v = parse(DepositStatusSchema, input);
  return mutate(options, "deposit_status", async (tx) => {
    const b = await loadForWrite(tx, bookingId, v.expectedRevision, { v3: true });
    if (b.depositStatus === v.status) return { booking: await detailOrThrow(tx, bookingId), noChange: true };
    if (v.status === "REJECTED" && b.depositStatus === "NONE")
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId, "There is no deposit proof to reject.");
    await bump(tx, bookingId, v.expectedRevision, { depositStatus: v.status });
    await audit(tx, actor, {
      action: "DEPOSIT_STATUS_CHANGED",
      bookingId,
      fromDepositStatus: b.depositStatus,
      toDepositStatus: v.status,
      reason: v.reason ?? null,
      fromRevision: v.expectedRevision,
      toRevision: v.expectedRevision + 1,
    });
    adminEvent("admin.booking.deposit_status", { bookingId, actorStaffId: actor.staffId, toRevision: v.expectedRevision + 1 });
    return { booking: await detailOrThrow(tx, bookingId), noChange: false };
  });
}

const PROOF_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export interface DepositProofImage { contentType: string; data: Uint8Array }

// The proof must belong to the booking in the URL; a guessed or foreign id is a plain 404.
export async function readDepositProof(actor: StaffActor, id: unknown, proofId: unknown, options: AdminOptions = {}): Promise<DepositProofImage> {
  authorize(actor, "READ");
  const bookingId = parse(AdminIdSchema, id), pid = parse(AdminIdSchema, proofId);
  const proof = await withStaffDb("STAFF_READ", (tx) => tx.bookingDepositProof.findFirst({
    where: { id: pid, bookingId }, select: { contentType: true, data: true },
  }), { access: "read", db: options.db, signal: options.signal });
  if (!proof) throw new AdminServiceError("NOT_FOUND");
  return proof;
}

// Fixed, server-derived image type; inline with no file name; never cached, sniffed, framed
// into another origin or allowed to run anything.
export function proofImageResponse(proof: DepositProofImage): Response {
  if (!PROOF_TYPES.has(proof.contentType)) throw new Error("Unexpected proof content type");
  return new Response(Buffer.from(proof.data), {
    status: 200,
    headers: {
      "Content-Type": proof.contentType,
      "Content-Length": String(proof.data.byteLength),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}

// GET /api/admin/bookings/[id]/deposit-proofs/[proofId]: a staff session, then the service.
// Errors use the usual admin JSON envelope.
export async function depositProofRoute(request: NextRequest, id: string, proofId: string): Promise<Response> {
  try {
    const session = assertStaff(await getStaffSessionFromRequest(request));
    const actor = { staffId: session.subject, role: session.role, sessionId: session.sessionId };
    return proofImageResponse(await readDepositProof(actor, id, proofId, { signal: request.signal }));
  } catch (error) {
    const e = error instanceof AdminServiceError ? error : asStaffAuthError(error);
    const envelope: AdminError = error instanceof AdminServiceError ? error.toEnvelope() : { ...e.toAdminError(), currentBooking: null };
    return NextResponse.json({ ok: false, error: envelope }, {
      status: e.status,
      headers: { ...ADMIN_RESPONSE_HEADERS, "X-Content-Type-Options": "nosniff", ...(e.retryAfterSeconds !== null ? { "Retry-After": String(e.retryAfterSeconds) } : {}) },
    });
  }
}
