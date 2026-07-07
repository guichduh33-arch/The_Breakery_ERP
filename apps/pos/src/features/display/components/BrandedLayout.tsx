// apps/pos/src/features/display/components/BrandedLayout.tsx
//
// Session 13 / Phase 4.C — D-4C-6.
//
// Token-only branded shell for the customer-display surface. Consumes
// `@breakery/ui` Tailwind preset (semantic tokens : `bg-bg-base`,
// `text-gold`, `text-text-primary`, etc.). NO hardcoded hex colors.
//
// Layout :
//   ┌──────────────────────────────────────────────────┐
//   │  THE BREAKERY               French Bakery & Co   │  ← header
//   ├──────────────────────────────────────────────────┤
//   │                                                  │
//   │             children (queue / cart)              │
//   │                                                  │
//   ├──────────────────────────────────────────────────┤
//   │              {footer microcopy}                  │  ← footer
//   └──────────────────────────────────────────────────┘

import type { ReactNode } from 'react';

import { BrandLogo } from '@breakery/ui';

interface BrandedLayoutProps {
  children: ReactNode;
  footer?: ReactNode;
}

export function BrandedLayout({ children, footer }: BrandedLayoutProps) {
  return (
    <div className="h-[100dvh] w-full bg-bg-base text-text-primary flex flex-col font-sans">
      <header className="px-12 py-7 border-b border-border-subtle flex items-center justify-between">
        {/* The real brand logo is THE brand moment on the customer display —
            present in the header of EVERY state (pairing / loading / idle /
            active order / payment), so the customer always sees the actual
            croissant mark, not just a typeset wordmark. The heading semantics
            are preserved via the sr-only name. */}
        <h1 className="m-0 flex items-center">
          <BrandLogo size="md" showTagline={false} />
          <span className="sr-only">The Breakery</span>
        </h1>
        <p className="text-sm uppercase tracking-[0.3em] text-text-secondary">
          French Bakery &amp; Pastry
        </p>
      </header>

      <main className="flex-1 overflow-hidden px-12 py-10">{children}</main>

      <footer className="px-12 py-6 border-t border-border-subtle text-xs text-text-muted tracking-wider uppercase">
        {footer ?? <span>Open daily · 07:00 — 21:00</span>}
      </footer>
    </div>
  );
}
