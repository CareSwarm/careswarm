/** @type {import('next').NextConfig} */
const ORCH = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Same-origin proxy to the orchestrator — no CORS, one URL for judges
    return [{ source: '/api/:path*', destination: `${ORCH}/api/:path*` }];
  },
};

export default nextConfig;
