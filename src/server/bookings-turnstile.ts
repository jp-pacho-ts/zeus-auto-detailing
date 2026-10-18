import "server-only";
import { readProviderJson } from "./bookings-provider";
import { randomUUID } from "node:crypto";
import { createSemaphore } from "./auth/semaphore";
const permits = createSemaphore({
    maxActive: 4, maxQueued: 8, maxWaitMs: 1000
});
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export async function verifyTurnstile(token: string, config: {
    secret: string;
    hostnames: string[];
}, options: {
    endpoint?: string;
    timeoutMs?: number;
    remoteip?: string;
    signal?: AbortSignal;
} = {}): Promise<"VERIFIED" | "INVALID" | "UNAVAILABLE"> {
    let release: (() => void) | undefined;
    try {
        release = await permits.acquire(options.signal);
        const timeout = AbortSignal.timeout(options.timeoutMs ?? 5000), signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
        const body = new URLSearchParams({
            secret: config.secret, response: token, idempotency_key: randomUUID()
        });
        if (options.remoteip)
            body.set("remoteip", options.remoteip);
        // Endpoint override is a server-only injection seam, never a request/environment value.
        const response = await fetch(options.endpoint ?? SITEVERIFY, {
            method: "POST", body, signal, redirect: "error"
        });
        if (!response.ok)
            return "UNAVAILABLE";
        const result: unknown = await readProviderJson(response);
        if (!result || typeof result !== "object" || !("success" in result) || typeof result.success !== "boolean")
            return "UNAVAILABLE";
        if ("error-codes" in result && Array.isArray(result["error-codes"]) && result["error-codes"].includes("internal-error"))
            return "UNAVAILABLE";
        return result.success === true && "action" in result && result.action === "booking_create" && "hostname" in result && typeof result.hostname === "string" && config.hostnames.includes(result.hostname) ? "VERIFIED" : "INVALID";
    }
    catch {
        return "UNAVAILABLE";
    }
    finally {
        release?.();
    }
}

// trustedClientKey anonymizes IPv6 to /64; Siteverify remoteip is optional and needs a full visitor address.
export function turnstileRemoteIp(key: string): string | undefined { return key === "local" || key === "untrusted" || key.includes("/") ? undefined : key; }
