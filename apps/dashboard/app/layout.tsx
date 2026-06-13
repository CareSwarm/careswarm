import './globals.css';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CareSwarm — local-first AI agent economy',
  description: 'A swarm of medical AI agents running entirely on one 8GB laptop, powered by QVAC.',
};

const NAV = [
  { href: '/', label: 'Swarm' },
  { href: '/agents', label: 'Agents' },
  { href: '/metrics', label: 'Metrics' },
  { href: '/economy', label: 'Economy' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <nav className="border-b border-[var(--border)] px-6 py-3 flex items-center gap-6 sticky top-0 bg-[var(--bg)]/90 backdrop-blur z-10">
          <span className="text-lg font-bold text-[var(--accent)]">🐝 CareSwarm</span>
          <span className="text-xs text-[var(--muted)] hidden sm:block">
            local-first agent economy · QVAC on-device · no cloud AI
          </span>
          <div className="ml-auto flex gap-4 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors">
                {n.label}
              </Link>
            ))}
          </div>
        </nav>
        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
