import './globals.css';
import type { Metadata } from 'next';
import NavLinks from './components/NavLinks';

export const metadata: Metadata = {
  title: 'CareSwarm — local-first AI agent economy',
  description: 'A swarm of medical AI agents running entirely on one 8GB laptop, powered by QVAC.',
};

const REPLAY = process.env.NEXT_PUBLIC_REPLAY === '1';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {REPLAY && (
          <div className="bg-[var(--accent2)]/15 border-b border-[var(--accent2)]/40 px-6 py-2 text-xs text-[var(--accent2)] text-center">
            🔁 Replay of a real run recorded on an 8GB MacBook Air — the AI runs on-device via QVAC, not in the cloud.{' '}
            <a href="https://github.com/CareSwarm/careswarm" className="underline" target="_blank">run it yourself ↗</a>
          </div>
        )}
        <nav className="border-b border-[var(--border)] px-6 py-3 flex items-center gap-6 sticky top-0 bg-[var(--bg)]/80 backdrop-blur-md z-10">
          <img src="/logo.svg" alt="CareSwarm" className="h-10 w-auto" />
          <span className="text-xs text-[var(--muted)] hidden md:block border-l border-[var(--border)] pl-6">
            local-first agent economy · QVAC on-device · no cloud AI
          </span>
          <NavLinks />
        </nav>
        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
