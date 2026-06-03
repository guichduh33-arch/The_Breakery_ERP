// apps/pos/src/features/cart/CustomerAttachModal.tsx
//
// Session 14 / Phase 2.B — POS-side customer attach modal.
//
// Ref: docs/Design/caissapp/50-customer-attach-search-list.jpg
//
// Centered dialog with the title "Select a Customer", a 4-tab control
// (SEARCH / FAVORITES / QR / NEW), a search bar and a list of customer rows.
// Each row has:
//   - Colored avatar circle (initial)
//   - Name + (for B2B-like) "Bali Organic Store" sub-line
//   - Customer category badge (top, e.g. "Wholesale" green) + tier badge
//     (bottom, e.g. "Bronze" / "Gold")
//   - Heart (favorite) + Clock (history) icon buttons on the right
//
// Wire-up — the caller hands in `searchFn` and `createFn` so we don't
// duplicate the supabase query logic that already lives in `Pos.tsx`.

import { Heart, History, QrCode, Search, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { Customer, LoyaltyTier } from '@breakery/domain';
import { tierFromLifetime } from '@breakery/domain';
import {
  CustomerCategoryBadge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  cn,
} from '@breakery/ui';
import type { CustomerWithCategory } from '@/stores/cartStore';

interface CustomerAttachModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (customer: Customer) => void;
  searchFn: (query: string) => Promise<CustomerWithCategory[]>;
  createFn?: (input: { name: string; phone: string; email?: string }) => Promise<Customer>;
}

type TabKey = 'search' | 'favorites' | 'qr' | 'new';

const SR_ONLY = 'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

const TIER_PILL: Record<LoyaltyTier, string> = {
  bronze: 'bg-amber-warn/15 text-amber-warn border-amber-warn/30',
  silver: 'bg-text-secondary/15 text-text-secondary border-text-secondary/30',
  gold: 'bg-gold-soft text-gold border-gold/40',
  platinum: 'bg-blue-info/15 text-blue-info border-blue-info/30',
};

const TIER_LABEL: Record<LoyaltyTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

const AVATAR_TINTS = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-violet-500',
] as const;

function avatarTint(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length] as string;
}

function firstInitial(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  return trimmed.charAt(0).toUpperCase();
}

function CustomerRow({
  customer,
  onSelect,
}: {
  customer: CustomerWithCategory;
  onSelect: () => void;
}): JSX.Element {
  const tier = tierFromLifetime(customer.lifetime_points);
  const initial = firstInitial(customer.name);
  const tint = avatarTint(customer.id);
  // Use phone as sub-line; fall back to email or company name if available.
  const subline = customer.phone ?? customer.email ?? null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left rounded-xl border border-border-subtle bg-bg-elevated px-4 py-3',
        'flex items-center gap-3',
        'hover:bg-bg-overlay/60 active:scale-[0.99]',
        'transition-colors duration-fast motion-reduce:transition-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
      )}
      data-customer-id={customer.id}
    >
      <span
        className={cn(
          'h-11 w-11 rounded-full inline-flex items-center justify-center shrink-0',
          'text-white font-semibold text-sm',
          tint,
        )}
        aria-hidden
      >
        {initial}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">
          {customer.name}
        </p>
        {subline && (
          <p className="text-xs text-text-secondary truncate font-mono">
            {subline}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {customer.category !== undefined && (
          <CustomerCategoryBadge category={customer.category ?? null} />
        )}
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest',
            TIER_PILL[tier],
          )}
        >
          <span>{TIER_LABEL[tier]}</span>
          <span className="font-mono normal-case tracking-normal text-text-muted">
            {customer.loyalty_points.toLocaleString()} pts
          </span>
        </span>
      </div>
      <div className="hidden sm:flex flex-col items-center gap-1 shrink-0 pl-2 border-l border-border-subtle">
        <span
          aria-hidden
          className="h-8 w-8 inline-flex items-center justify-center rounded-md text-text-muted hover:text-rose-400"
          title="Favorite"
        >
          <Heart className="h-4 w-4" />
        </span>
        <span
          aria-hidden
          className="h-8 w-8 inline-flex items-center justify-center rounded-md text-text-muted hover:text-gold"
          title="Recent"
        >
          <History className="h-4 w-4" />
        </span>
      </div>
    </button>
  );
}

interface QuickCreateState {
  name: string;
  phone: string;
  email: string;
}

function QuickCreateForm({
  onSubmit,
  isSubmitting,
}: {
  onSubmit: (data: QuickCreateState) => void;
  isSubmitting: boolean;
}): JSX.Element {
  const [form, setForm] = useState<QuickCreateState>({ name: '', phone: '', email: '' });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-1">
      <Input
        placeholder="Full name"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        required
        autoFocus
        aria-label="Full name"
      />
      <Input
        placeholder="Phone (e.g. +6281234567890)"
        value={form.phone}
        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        required
        aria-label="Phone"
      />
      <Input
        placeholder="Email (optional)"
        type="email"
        value={form.email}
        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        aria-label="Email"
      />
      <button
        type="submit"
        disabled={!form.name.trim() || !form.phone.trim() || isSubmitting}
        className={cn(
          'h-12 mt-1 inline-flex items-center justify-center gap-2 rounded-md',
          'bg-gold hover:bg-gold-hover text-bg-base font-bold uppercase tracking-widest text-sm',
          'transition-colors duration-fast motion-reduce:transition-none',
          'disabled:opacity-50 disabled:pointer-events-none',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
        )}
      >
        <UserPlus className="h-4 w-4" aria-hidden />
        {isSubmitting ? 'Creating…' : 'Create Customer'}
      </button>
    </form>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  variant = 'default',
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNodeIcon;
  label: string;
  variant?: 'default' | 'primary';
}): JSX.Element {
  const isPrimary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-10 px-3 inline-flex items-center justify-center gap-2 rounded-md text-xs font-bold uppercase tracking-widest',
        'transition-colors duration-fast motion-reduce:transition-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
        isPrimary
          ? active
            ? 'bg-success text-white'
            : 'bg-success/15 text-success hover:bg-success/25'
          : active
            ? 'bg-gold-soft text-gold border border-gold'
            : 'bg-bg-overlay text-text-secondary border border-border-subtle hover:text-text-primary',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

type ReactNodeIcon = JSX.Element;

export function CustomerAttachModal({
  open,
  onClose,
  onSelect,
  searchFn,
  createFn,
}: CustomerAttachModalProps): JSX.Element {
  const [tab, setTab] = useState<TabKey>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerWithCategory[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setTab('search');
      setQuery('');
      setResults([]);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (tab !== 'search' || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const run = async (): Promise<void> => {
      setIsSearching(true);
      try {
        const res = await searchFn(query);
        setResults(res);
      } finally {
        setIsSearching(false);
      }
    };
    debounceRef.current = setTimeout(() => {
      void run();
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [tab, query, searchFn]);

  async function handleCreate(data: QuickCreateState): Promise<void> {
    if (!createFn) return;
    setIsCreating(true);
    try {
      const input: { name: string; phone: string; email?: string } = {
        name: data.name,
        phone: data.phone,
      };
      if (data.email) input.email = data.email;
      const created = await createFn(input);
      onSelect(created);
      onClose();
    } finally {
      setIsCreating(false);
    }
  }

  const showNewCta = useMemo(
    () =>
      tab === 'search' &&
      query.trim().length >= 2 &&
      results.length === 0 &&
      !isSearching &&
      Boolean(createFn),
    [tab, query, results.length, isSearching, createFn],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl p-0 gap-0 bg-bg-elevated">
        <DialogTitle asChild>
          <span className={SR_ONLY}>Select a customer</span>
        </DialogTitle>
        <DialogDescription asChild>
          <span className={SR_ONLY}>
            Search by name or phone, pick from your favorites, scan a QR code,
            or create a new customer.
          </span>
        </DialogDescription>

        <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-2 min-w-0">
            <UserPlus className="h-5 w-5 text-gold" aria-hidden />
            <h2 className="font-display italic text-lg text-text-primary">
              Select a Customer
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              'h-9 w-9 inline-flex items-center justify-center rounded-md',
              'text-text-secondary hover:text-text-primary hover:bg-bg-overlay',
              'transition-colors duration-fast motion-reduce:transition-none',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
            )}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="grid grid-cols-4 gap-2 px-6 pt-4">
          <TabButton
            active={tab === 'search'}
            onClick={() => setTab('search')}
            icon={<Search className="h-4 w-4" aria-hidden />}
            label="Search"
          />
          <TabButton
            active={tab === 'favorites'}
            onClick={() => setTab('favorites')}
            icon={<Heart className="h-4 w-4" aria-hidden />}
            label="Favorites"
          />
          <TabButton
            active={tab === 'qr'}
            onClick={() => setTab('qr')}
            icon={<QrCode className="h-4 w-4" aria-hidden />}
            label="QR"
          />
          <TabButton
            active={tab === 'new'}
            onClick={() => setTab('new')}
            icon={<UserPlus className="h-4 w-4" aria-hidden />}
            label="New"
            variant="primary"
          />
        </div>

        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-3">
          {tab === 'search' && (
            <>
              <Input
                autoFocus
                placeholder="Search by name, phone, email…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search customer"
                data-vkp="qwerty"
              />
              {isSearching && (
                <p className="text-xs text-text-secondary px-1">Searching…</p>
              )}
              {query.trim().length < 2 && !isSearching && (
                <p className="text-xs text-text-muted italic px-1">
                  Type at least 2 characters to search by name or phone.
                </p>
              )}
              {results.map((c) => (
                <CustomerRow
                  key={c.id}
                  customer={c}
                  onSelect={() => {
                    onSelect(c);
                    onClose();
                  }}
                />
              ))}
              {showNewCta && (
                <button
                  type="button"
                  onClick={() => setTab('new')}
                  className={cn(
                    'w-full h-12 rounded-md border border-dashed border-gold text-gold',
                    'inline-flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest',
                    'hover:bg-gold-soft transition-colors duration-fast motion-reduce:transition-none',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
                  )}
                >
                  <UserPlus className="h-4 w-4" aria-hidden />
                  Create “{query}” as new customer
                </button>
              )}
            </>
          )}

          {tab === 'favorites' && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Heart className="h-10 w-10 text-text-muted opacity-40" aria-hidden />
              <p className="font-display italic text-base text-text-primary">
                No favorites yet
              </p>
              <p className="text-xs text-text-muted max-w-sm">
                Tap the heart on a customer in the search results to pin them
                here for one-tap recall.
              </p>
            </div>
          )}

          {tab === 'qr' && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <QrCode className="h-10 w-10 text-text-muted opacity-40" aria-hidden />
              <p className="font-display italic text-base text-text-primary">
                QR scan coming soon
              </p>
              <p className="text-xs text-text-muted max-w-sm">
                Customers will be able to flash their loyalty QR for instant
                attach.
              </p>
            </div>
          )}

          {tab === 'new' && (
            <QuickCreateForm
              onSubmit={(d) => {
                void handleCreate(d);
              }}
              isSubmitting={isCreating}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
