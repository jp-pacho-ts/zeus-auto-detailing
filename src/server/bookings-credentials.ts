import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { parseQuoteKeyRing, type QuoteKeyRing } from "./catalog-quote-token";
import { clientIdentityConfig } from "./auth/client-identity";
type Env = Record<string, string | undefined>;
export interface BookingConfiguration {
    quote: QuoteKeyRing;
    grant: QuoteKeyRing;
    session: QuoteKeyRing;
    mode: "OPEN" | "PAUSED";
    origin: string;
    challenge: {
        secret: string;
        hostnames: string[];
    };
    identity: ReturnType<typeof clientIdentityConfig>;
}
export function parseBookingConfiguration(env: Env = process.env): BookingConfiguration {
    const ring = (name: string) => parseQuoteKeyRing({
        BOOKING_QUOTE_KEYS: env[name + "_KEYS"], BOOKING_QUOTE_ACTIVE_KID: env[name + "_ACTIVE_KID"], ORIGIN_AUTH_SECRET: env.ORIGIN_AUTH_SECRET
    });
    const quote = ring("BOOKING_QUOTE"), grant = ring("MANAGEMENT_GRANT"), session = ring("MANAGEMENT_SESSION");
    const all = [...quote.keys.values(), ...grant.keys.values(), ...session.keys.values()];
    if (new Set(all.map(k => k.toString("base64url"))).size !== all.length)
        throw new Error("Booking key rings must use distinct secrets");
    const mode = env.ONLINE_BOOKING_MODE;
    if (mode !== "OPEN" && mode !== "PAUSED")
        throw new Error("ONLINE_BOOKING_MODE must be OPEN or PAUSED");
    const origin = new URL(env.APP_ORIGIN ?? "");
    if (origin.origin !== env.APP_ORIGIN || origin.username || origin.password || !["https:", "http:"].includes(origin.protocol) || (env.NODE_ENV === "production" && origin.protocol !== "https:"))
        throw new Error("APP_ORIGIN must be an exact permitted origin");
    const secret = env.TURNSTILE_SECRET_KEY, site = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, hostnames = env.TURNSTILE_ALLOWED_HOSTNAMES?.split(",");
    if (!secret || !site || !/^[A-Za-z0-9_-]{20,128}$/.test(secret) || !/^[A-Za-z0-9_-]{20,128}$/.test(site) || !hostnames?.length || hostnames.some(h => !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/.test(h)))
        throw new Error("Turnstile configuration is required");
    if (env.NODE_ENV === "production" && [secret, site].some(k => /^[123]x0/.test(k)))
        throw new Error("Turnstile test keys are forbidden in production");
    const identity = clientIdentityConfig(env);
    return {
        quote, grant, session, mode, origin: origin.origin, challenge: { secret, hostnames }, identity
    };
}
export function grantExpiry(issued: Date, dayEnd: Date, terminalAt: Date | null): Date {
    return new Date(Math.min(issued.getTime() + 30 * 86400000, Math.max(dayEnd.getTime(), (terminalAt ?? issued).getTime()) + 86400000));
}
const Claims = z.object({
  bookingId: z.string().uuid(), credentialVersion: z.number().int().min(1),
  issuedAt: z.string().datetime({ precision: 3 }), expiresAt: z.string().datetime({ precision: 3 }),
}).strict();
export type ManagementClaims = z.infer<typeof Claims> & { id?: string; grantKid: string };
type Purpose = "BOOKING_MANAGEMENT" | "BOOKING_MANAGEMENT_SESSION";
const Kid = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
const mac = (key: Buffer, body: string) => createHmac("sha256", key).update(body).digest();
const baseClaims = (c: ManagementClaims) => Claims.parse({bookingId:c.bookingId,credentialVersion:c.credentialVersion,issuedAt:c.issuedAt,expiresAt:c.expiresAt});
// ARCHITECTURE ManagementGrantClaims / ManagementSessionClaims are flat, with the same
// audience and distinct purposes/rings. Database issuance IDs are not token claims.
export function signManagementToken(purpose: Purpose, claims: ManagementClaims, ring: QuoteKeyRing): string {
  const payload = {v:1,kid:ring.activeKid,purpose,aud:"booking-management",...baseClaims(claims),...(purpose==="BOOKING_MANAGEMENT_SESSION"?{grantKid:Kid.parse(claims.grantKid)}:{})};
  const encoded=Buffer.from(JSON.stringify(payload)).toString("base64url"),key=ring.keys.get(ring.activeKid);
  if(!key)throw new Error("Management signer unavailable");
  return encoded+"."+mac(key,encoded).toString("base64url");
}
export function verifyManagementToken(token:string,purpose:Purpose,config:BookingConfiguration,now:Date):ManagementClaims|null {
  try {
    if(token.length>4096)return null;
    const parts=token.split(".");
    if(parts.length!==2||parts.some(p=>!/^[A-Za-z0-9_-]+$/.test(p)||Buffer.from(p,"base64url").toString("base64url")!==p))return null;
    const raw=new TextDecoder("utf-8",{fatal:true}).decode(Buffer.from(parts[0],"base64url"));
    const framing={v:z.literal(1),kid:Kid,purpose:z.literal(purpose),aud:z.literal("booking-management"),...Claims.shape};
    const parsed=purpose==="BOOKING_MANAGEMENT_SESSION"?z.object({...framing,grantKid:Kid}).strict().parse(JSON.parse(raw)):z.object(framing).strict().parse(JSON.parse(raw));
    const grantKid=Kid.parse("grantKid" in parsed?parsed.grantKid:parsed.kid);
    const ring=purpose==="BOOKING_MANAGEMENT"?config.grant:config.session,key=ring.keys.get(parsed.kid),tag=Buffer.from(parts[1],"base64url");
    if(!key||tag.length!==32||!timingSafeEqual(tag,mac(key,parts[0]))||JSON.stringify(parsed)!==raw||!config.grant.keys.has(grantKid))return null;
    const issued=Date.parse(parsed.issuedAt),expires=Date.parse(parsed.expiresAt),max=purpose==="BOOKING_MANAGEMENT"?30*86400000:86400000;
    if(issued>now.getTime()+60000||expires<=now.getTime()||expires<=issued||expires-issued>max)return null;
    return {...Claims.parse({bookingId:parsed.bookingId,credentialVersion:parsed.credentialVersion,issuedAt:parsed.issuedAt,expiresAt:parsed.expiresAt}),grantKid};
  }catch{return null;}
}
