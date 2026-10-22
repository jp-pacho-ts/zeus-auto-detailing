// P1-12 A8 (Codex review, exact launch policy). Read by next.config.mjs at build and start.
// Every response: no framing, no MIME sniffing, no referrer; HSTS (one year, this host only, no
// preload) in production only, since loopback checks run over plain http. HTML documents also get
// one CSP. It allows inline scripts and styles because Next's bootstrap and React style attributes
// need them; a per-response nonce would need dynamic rendering. Turnstile loads its script and
// frame from challenges.cloudflare.com. /api routes are left to their own, stricter headers (the
// sandboxed proof image, no-store JSON).

/** @param {boolean} production */
export function documentContentSecurityPolicy(production) {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** @param {boolean} production */
export function securityHeaders(production) {
  return [
    {
      source: "/:path*",
      headers: [
        ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    },
    {
      // Every path except /api/...: pages, error pages and their assets.
      source: "/:path((?!api/).*)",
      headers: [{ key: "Content-Security-Policy", value: documentContentSecurityPolicy(production) }],
    },
  ];
}
