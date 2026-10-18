/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next 16 `next dev` otherwise writes an agent-rules block into AGENTS.md in AI-agent sessions (P1-15).
  agentRules: false,
};

export default nextConfig;
