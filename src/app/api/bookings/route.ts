import { bookingPost } from "@/server/bookings-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> { return bookingPost(request); }
