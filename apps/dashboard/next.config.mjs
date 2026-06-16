/** @type {import('next').NextConfig} */
const ORCH = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4000';
const REPLAY = process.env.NEXT_PUBLIC_REPLAY === '1';

const nextConfig = {
  reactStrictMode: true,
  // In replay mode there's no orchestrator — the dashboard reads /replay/*.json,
  // so skip the proxy entirely (it would point at an unreachable localhost).
  async rewrites() {
    if (REPLAY) return [];
    // Same-origin proxy to the orchestrator — no CORS, one URL for judges
    return [{ source: '/api/:path*', destination: `${ORCH}/api/:path*` }];
  },
};

export default nextConfig;
