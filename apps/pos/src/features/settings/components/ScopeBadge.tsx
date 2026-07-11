// apps/pos/src/features/settings/components/ScopeBadge.tsx
//
// S73 (audit 1.1.1) — explicit persistence scope on every settings block:
// 'org'      → stored in business_config (DB, shared by every terminal)
// 'terminal' → stored in posSettingsStore (localStorage, this device only)
import type { JSX } from 'react';
import { Building2, MonitorSmartphone } from 'lucide-react';
import { cn } from '@breakery/ui';

export function ScopeBadge({ scope }: { scope: 'org' | 'terminal' }): JSX.Element {
  const isOrg = scope === 'org';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest',
        isOrg
          ? 'border-gold/40 text-gold bg-gold/10'
          : 'border-border-subtle text-text-muted bg-bg-overlay',
      )}
      title={
        isOrg
          ? 'Shared setting — applies to every terminal (stored in the database).'
          : 'This terminal only — stored on this device.'
      }
    >
      {isOrg ? (
        <Building2 className="h-3 w-3" aria-hidden />
      ) : (
        <MonitorSmartphone className="h-3 w-3" aria-hidden />
      )}
      {isOrg ? 'Établissement' : 'Ce terminal'}
    </span>
  );
}
