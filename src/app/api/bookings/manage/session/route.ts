import { managementHttp } from "@/server/bookings-management-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => managementHttp(request, "exchange");
export const DELETE = (request: Request) => managementHttp(request, "forget");
