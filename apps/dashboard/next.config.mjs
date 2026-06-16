import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const ORCH = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4000';
const REPLAY = process.env.NEXT_PUBLIC_REPLAY === '1';
const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
  // This app is self-contained — trace from here, not the monorepo root
  // (silences the multi-lockfile warning and keeps the build standalone).
  outputFileTracingRoot: here,
  // In replay mode there's no orchestrator — the dashboard reads /replay/*.json,
  // so skip the proxy entirely (it would point at an unreachable localhost).
  async rewrites() {
    if (REPLAY) return [];
    // Same-origin proxy to the orchestrator — no CORS, one URL for judges
    return [{ source: '/api/:path*', destination: `${ORCH}/api/:path*` }];
  },
};

export default nextConfig;
