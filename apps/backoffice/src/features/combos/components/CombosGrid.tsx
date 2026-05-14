// apps/backoffice/src/features/combos/components/CombosGrid.tsx
//
// Session 14 / Phase 4.B — Card grid + search bar for the Combo Management
// page.

import { Search, Sparkles } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';
import { EmptyState, Input } from '@breakery/ui';
import { ComboCard } from './ComboCard.js';
import type { Combo } from '../types.js';

interface Props {
  combos: ReadonlyArray<Combo>;
  isLoading?: boolean;
}

export function CombosGrid({ combos, isLoading = false }: Props): JSX.Element {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') return combos;
    return combos.filter((c) => c.name.toLowerCase().includes(needle));
  }, [combos, search]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
        <Input
          aria-label="Search combos"
          placeholder="Search for a combo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-full pl-9"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[4/5] animate-pulse rounded-lg border border-border-subtle bg-bg-overlay"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No combos yet"
          description="Create your first combo to bundle products at a curated price."
          size="lg"
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <ComboCard key={c.id} combo={c} />
          ))}
        </div>
      )}
    </div>
  );
}
