import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type JSX } from 'react';
import type { Customer } from '@breakery/domain';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import { ScrollArea } from '../primitives/ScrollArea.js';
import { FullScreenModal } from './FullScreenModal.js';
import { LoyaltyBadge } from './LoyaltyBadge.js';
import { tierFromLifetime } from '@breakery/domain';

const SR_ONLY = 'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

export interface CustomerSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (customer: Customer) => void;
  searchFn: (query: string) => Promise<Customer[]>;
  createFn?: (input: { name: string; phone: string; email?: string }) => Promise<Customer>;
}

interface QuickCreateState {
  name: string;
  phone: string;
  email: string;
}

function QuickCreateForm({
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  onSubmit: (data: QuickCreateState) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}): JSX.Element {
  const [form, setForm] = useState<QuickCreateState>({ name: '', phone: '', email: '' });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6">
      <h3 className="font-serif text-xl font-semibold">New customer</h3>
      <Input
        placeholder="Name *"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        required
        autoFocus
      />
      <Input
        placeholder="Phone *"
        value={form.phone}
        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        required
      />
      <Input
        placeholder="Email (optional)"
        type="email"
        value={form.email}
        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
      />
      <div className="flex gap-3 justify-end">
        <Button type="button" variant="secondary" size="lg" onClick={onCancel}>
          Back
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={!form.name.trim() || !form.phone.trim() || isSubmitting}
        >
          {isSubmitting ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

export function CustomerSearchModal({
  open,
  onClose,
  onSelect,
  searchFn,
  createFn,
}: CustomerSearchModalProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setShowCreate(false);
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const runSearch = async () => {
      setIsSearching(true);
      try {
        const res = await searchFn(query);
        setResults(res);
      } finally {
        setIsSearching(false);
      }
    };
    debounceRef.current = setTimeout(() => { void runSearch(); }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchFn]);

  async function handleCreate(data: QuickCreateState): Promise<void> {
    if (!createFn) return;
    setIsCreating(true);
    try {
      const input: { name: string; phone: string; email?: string } = {
        name: data.name,
        phone: data.phone,
      };
      if (data.email) input.email = data.email;
      const customer = await createFn(input);
      onSelect(customer);
    } finally {
      setIsCreating(false);
    }
  }

  const showNewCta = query.length >= 2 && results.length === 0 && !isSearching && !!createFn;

  return (
    <FullScreenModal open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Title asChild>
        <span className={cn(SR_ONLY)}>Search customer</span>
      </DialogPrimitive.Title>
      <DialogPrimitive.Description asChild>
        <span className={cn(SR_ONLY)}>Search by phone or name, or create a new customer.</span>
      </DialogPrimitive.Description>

      <header className="h-14 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
        <h2 className="font-serif text-xl">Attach customer</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </header>

      {showCreate ? (
        <ScrollArea className="flex-1">
          <QuickCreateForm
            onSubmit={(d) => { void handleCreate(d); }}
            onCancel={() => setShowCreate(false)}
            isSubmitting={isCreating}
          />
        </ScrollArea>
      ) : (
        <>
          <div className="px-6 py-4 border-b border-border-subtle">
            <Input
              autoFocus
              placeholder="Phone or name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search customer"
            />
          </div>
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
              {isSearching && (
                <p className="text-text-secondary text-sm px-2">Searching…</p>
              )}
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={cn(
                    'h-touch-large w-full rounded-md border border-border-subtle bg-bg-elevated px-4 flex items-center justify-between gap-4 text-left hover:bg-bg-overlay active:scale-95 transition-colors',
                  )}
                  onClick={() => onSelect(c)}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary truncate">{c.name}</p>
                    {c.phone && (
                      <p className="text-sm text-text-secondary">{c.phone}</p>
                    )}
                  </div>
                  {c.loyalty_points > 0 && (
                    <LoyaltyBadge
                      tier={tierFromLifetime(c.lifetime_points)}
                      points={c.loyalty_points}
                    />
                  )}
                </button>
              ))}
              {showNewCta && (
                <button
                  type="button"
                  className={cn(
                    'h-touch-large w-full rounded-md border border-dashed border-border-strong bg-transparent px-4 flex items-center justify-center gap-2 text-text-secondary hover:bg-bg-overlay active:scale-95 transition-colors',
                  )}
                  onClick={() => setShowCreate(true)}
                >
                  <span className="text-xl font-bold">+</span>
                  <span>New customer</span>
                </button>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </FullScreenModal>
  );
}
