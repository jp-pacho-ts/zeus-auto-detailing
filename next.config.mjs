import { securityHeaders } from "./src/config/security-headers.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next 16 `next dev` otherwise writes an agent-rules block into AGENTS.md in AI-agent sessions (P1-15).
  agentRules: false,
  // P1-12 A8: framing, sniffing, referrer, HSTS (production) and the document CSP.
  async headers() {
    return securityHeaders(process.env.NODE_ENV === "production");
  },
};

export default nextConfig;
