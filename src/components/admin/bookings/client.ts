import type { AdminBookingDetail, AdminError } from "@/types/admin-contracts";

export class AdminRequestError extends Error {
  readonly currentBooking: AdminBookingDetail | null;
  readonly fieldErrors: Record<string, string[]>;
  readonly commitState: string;
  constructor(
    public readonly status: number,
    public readonly detail: Partial<AdminError>,
  ) {
    super(detail.message ?? "The shop server is unavailable. Please retry.");
    this.currentBooking = detail.currentBooking ?? null;
    this.fieldErrors = detail.fieldErrors ?? {};
    this.commitState = detail.commitState ?? "UNKNOWN";
  }
}
type Options = { method?: string; body?: unknown; signal?: AbortSignal };
// PII selectors go only in JSON bodies. No external URL or implicit HTTP cache.
export async function adminRequest<T>(
  url: string,
  options: Options = {},
  transport: typeof fetch = fetch,
): Promise<T> {
  if (
    !/^\/api\/(admin\/|catalog$)/.test(url) ||
    /[?&](phone|q|email|name)=/i.test(url)
  )
    throw new Error("Invalid admin request path");
  const response = await transport(url, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
    headers:
      options.body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  if (response.status === 204 && response.ok) return null as T;
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true)
    throw new AdminRequestError(response.status, result?.error ?? {});
  return result.data as T;
}
export function requestGeneration() {
  let version = 0;
  return {
    next: () => ++version,
    current: (value: number) => value === version,
    clear: () => {
      version++;
    },
  };
}
