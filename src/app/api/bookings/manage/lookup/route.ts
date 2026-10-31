import { managementHttp } from "@/server/bookings-management-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// P1-32: reference code + last name opens a short session; every failure is the same answer.
export const POST = (request: Request) => managementHttp(request, "lookup");
