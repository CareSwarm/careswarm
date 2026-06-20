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
  // The repo root has QVAC's bare-runtime deps (bare-fs/os/stdio…). Built from
  // here, webpack resolves React's `process` import to bare-stdio's polyfill and
  // drags its native `.addon()` binding loaders into the client bundle — which
  // throws in the browser and kills hydration. The client only needs
  // process.env.NODE_ENV (Next inlines it), so keep process + bare-* out.
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.alias = { ...config.resolve.alias, process: false };
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'bare-fs': false, 'bare-os': false, 'bare-stdio': false,
        'bare-tty': false, 'bare-signals': false, 'bare-url': false,
        'bare-events': false, 'bare-path': false,
      };
    }
    return config;
  },
  // In replay mode there's no orchestrator — the dashboard reads /replay/*.json,
  // so skip the proxy entirely (it would point at an unreachable localhost).
  async rewrites() {
    if (REPLAY) return [];
    // Same-origin proxy to the orchestrator — no CORS, one URL for judges
    return [{ source: '/api/:path*', destination: `${ORCH}/api/:path*` }];
  },
};

export default nextConfig;
