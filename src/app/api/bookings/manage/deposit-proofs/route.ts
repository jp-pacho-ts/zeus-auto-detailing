import { depositProofHttp } from "@/server/deposit-proofs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// P1-18: customers send a deposit proof. This route has no read method: files are never served back.
export const POST = (request: Request) => depositProofHttp(request);
