'use client';

// Top-nav with an active-route indicator (the current page gets an emerald pill).

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: 'Swarm' },
  { href: '/agents', label: 'Agents' },
  { href: '/metrics', label: 'Metrics' },
  { href: '/economy', label: 'Economy' },
];

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <div className="ml-auto flex items-center gap-1">
      {NAV.map((n) => {
        const active = pathname === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
              active
                ? 'text-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-inset ring-[var(--accent)]/30'
                : 'text-[var(--text)]/65 hover:text-[var(--text)] hover:bg-[var(--text)]/5'
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </div>
  );
}
