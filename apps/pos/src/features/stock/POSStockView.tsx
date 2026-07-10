// apps/pos/src/features/stock/POSStockView.tsx
//
// Session 14 — Phase 2.D — Full-screen POS-side cafe stock view.
//
// Visual refs:
//   - 70-cafe-stock-grid-all.jpg            (default — all categories)
//   - 71-cafe-stock-classic-breads-filtered (category-filtered)
//   - 72-cafe-stock-item-received-5.jpg     (after receive)
//   - 73-cafe-stock-categories-settings     (settings drawer — admin-gated)
//
// Layout per ref 70:
//   ┌─────────────────────────────────────────────────────────┐
//   │ ←  [icon] Cafe Stock          [⚙] [Nout] [Nlow] [Ntot] │  ← top bar
//   ├─────────────────────────────────────────────────────────┤
//   │ 🔍 search           [All] [Cat 1] [Cat 2] [Cat 3] …    │  ← cat chips
//   ├─────────────────────────────────────────────────────────┤
//   │ [card] [card] [card] [card] [card]                       │  ← 5-col grid
//   │ [card] [card] [card] [card] [card]                       │
//   │ …                                                       │
//   └─────────────────────────────────────────────────────────┘
//
// Reachable at `/pos/stock`. Triggered from SideMenuDrawer "Cafe Stock".

import { useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, LayoutGrid, List, Search, Settings, Package } from 'lucide-react';
import { toast } from 'sonner';
import { Button, cn, EmptyState } from '@breakery/ui';
import { usePOSStockProducts, type POSStockProductRow } from './hooks/usePOSStockProducts';
import { usePOSReceiveStock, POSReceiveStockError } from './hooks/usePOSReceiveStock';
import { useReturnToKitchen, DisplayGestureError } from './hooks/useReturnToKitchen';
import { useWasteDisplay } from './hooks/useWasteDisplay';
import { useAdjustDisplay } from './hooks/useAdjustDisplay';
import { POSStockCard } from './components/POSStockCard';
import { POSStockRow } from './components/POSStockRow';
import { POSStockCategoriesSettings } from './components/POSStockCategoriesSettings';
import { useAuthStore } from '@/stores/authStore';

const STOCK_VIEW_KEY = 'pos-stock-view';
const PERMISSION_MSG = 'You do not have permission to manage display stock.';

export default function POSStockView(): JSX.Element {
  const navigate = useNavigate();
  const products = usePOSStockProducts();
  const receive = usePOSReceiveStock();
  const returnToKitchen = useReturnToKitchen();
  const wasteDisplay = useWasteDisplay();
  const adjustDisplay = useAdjustDisplay();
  const hasDisplayManage = useAuthStore((s) => s.hasPermission('display.manage'));
  const hasInventoryManage = useAuthStore((s) => s.hasPermission('settings.update'));

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [enabledCategories, setEnabledCategories] = useState<Set<string> | null>(null);
  const [viewMode, setViewMode] = useState<'card' | 'list'>(() => {
    if (typeof window === 'undefined') return 'card';
    return window.localStorage.getItem(STOCK_VIEW_KEY) === 'list' ? 'list' : 'card';
  });

  function changeView(next: 'card' | 'list'): void {
    setViewMode(next);
    try {
      window.localStorage.setItem(STOCK_VIEW_KEY, next);
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  }

  const rows = products.data ?? [];
  const isMutating =
    receive.isPending ||
    returnToKitchen.isPending ||
    wasteDisplay.isPending ||
    adjustDisplay.isPending;

  // KPI counts
  const counts = useMemo(() => {
    let out = 0;
    let low = 0;
    for (const r of rows) {
      if (r.display_stock <= 0) out++;
      else if (r.min_stock_threshold > 0 && r.display_stock <= r.min_stock_threshold) low++;
    }
    return { out, low, total: rows.length };
  }, [rows]);

  // Category chips — built from product distribution.
  const categories = useMemo(() => {
    const map = new Map<string, { slug: string; name: string; count: number }>();
    for (const r of rows) {
      const prior = map.get(r.category_slug);
      if (prior) prior.count++;
      else map.set(r.category_slug, { slug: r.category_slug, name: r.category_name, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // Filtered list — search + category.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeCategory !== 'all' && r.category_slug !== activeCategory) return false;
      if (enabledCategories && !enabledCategories.has(r.category_slug)) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q);
    });
  }, [rows, search, activeCategory, enabledCategories]);

  function handleReceive(product: POSStockProductRow, qty: number): void {
    if (!hasDisplayManage) {
      toast.error(PERMISSION_MSG);
      return;
    }
    if (qty <= 0) return;
    receive.mutate(
      { productId: product.id, quantity: qty, idempotencyKey: crypto.randomUUID(), reason: 'pos_mise_en_vitrine' },
      {
        onSuccess: () => {
          toast.success(`${product.name}: +${qty} ${product.unit} to display`);
        },
        onError: (err: unknown) => {
          const e = err instanceof POSReceiveStockError ? err : null;
          toast.error(`Receive failed: ${e?.code ?? 'unknown'}`);
        },
      },
    );
  }

  function handleReturnToKitchen(product: POSStockProductRow, qty: number): void {
    if (!hasDisplayManage) {
      toast.error(PERMISSION_MSG);
      return;
    }
    if (qty <= 0) return;
    returnToKitchen.mutate(
      { productId: product.id, quantity: qty, idempotencyKey: crypto.randomUUID(), reason: 'pos_retour_cuisine' },
      {
        onSuccess: () => {
          toast.success(`${product.name}: −${qty} ${product.unit} returned to kitchen`);
        },
        onError: (err: unknown) => {
          const e = err instanceof DisplayGestureError ? err : null;
          toast.error(`Return to kitchen failed: ${e?.code ?? 'unknown'}`);
        },
      },
    );
  }

  function handleWaste(product: POSStockProductRow, qty: number, reason: string): void {
    if (!hasDisplayManage) {
      toast.error(PERMISSION_MSG);
      return;
    }
    if (qty <= 0) return;
    wasteDisplay.mutate(
      { productId: product.id, quantity: qty, idempotencyKey: crypto.randomUUID(), reason },
      {
        onSuccess: () => {
          toast.success(`${product.name}: −${qty} ${product.unit} waste`);
        },
        onError: (err: unknown) => {
          const e = err instanceof DisplayGestureError ? err : null;
          toast.error(`Waste failed: ${e?.code ?? 'unknown'}`);
        },
      },
    );
  }

  function handleAdjust(product: POSStockProductRow, newQty: number, reason: string): void {
    if (!hasDisplayManage) {
      toast.error(PERMISSION_MSG);
      return;
    }
    adjustDisplay.mutate(
      { productId: product.id, newQty, reason, idempotencyKey: crypto.randomUUID() },
      {
        onSuccess: () => {
          toast.success(`${product.name}: display adjusted to ${newQty} ${product.unit}`);
        },
        onError: (err: unknown) => {
          const e = err instanceof DisplayGestureError ? err : null;
          toast.error(`Adjust failed: ${e?.code ?? 'unknown'}`);
        },
      },
    );
  }

  return (
    <div className="h-screen flex flex-col bg-bg-base text-text-primary">
      {/* Top bar */}
      <header className="h-14 px-4 flex items-center gap-3 border-b border-border-subtle bg-bg-elevated">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={() => navigate('/pos')}
          data-testid="pos-stock-back"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Button>
        <Package className="h-5 w-5 text-gold" aria-hidden />
        <h1 className="font-display text-lg">Display Stock</h1>

        <div className="flex-1" />

        {/* View toggle — Card / List */}
        <div
          role="group"
          aria-label="View mode"
          className="inline-flex items-center rounded-md border border-border-subtle overflow-hidden"
        >
          <ViewToggleButton
            active={viewMode === 'card'}
            label="Card view"
            onClick={() => changeView('card')}
            testId="pos-stock-view-card"
          >
            <LayoutGrid className="h-4 w-4" aria-hidden />
          </ViewToggleButton>
          <ViewToggleButton
            active={viewMode === 'list'}
            label="List view"
            onClick={() => changeView('list')}
            testId="pos-stock-view-list"
          >
            <List className="h-4 w-4" aria-hidden />
          </ViewToggleButton>
        </div>

        {hasInventoryManage && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Category settings"
            onClick={() => setSettingsOpen(true)}
            data-testid="pos-stock-settings"
          >
            <Settings className="h-5 w-5" aria-hidden />
          </Button>
        )}

        <KpiChip tone="danger" icon={<Bell className="h-3 w-3" />} label={`${counts.out} out`} />
        <KpiChip tone="warning" icon={<Bell className="h-3 w-3" />} label={`${counts.low} low`} />
        <KpiChip tone="neutral" label={`${counts.total} products`} />
      </header>

      {/* Search + category chips */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-border-subtle">
        <label className="relative flex-1 max-w-xs">
          <Search className="h-4 w-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            aria-label="Search products"
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-elevated pl-9 pr-3 text-sm focus:outline focus:outline-2 focus:outline-gold"
            data-testid="pos-stock-search"
          />
        </label>
        <nav
          aria-label="Filter by category"
          className="flex-1 flex items-center gap-2 overflow-x-auto"
        >
          <CategoryChip
            label="All"
            count={rows.length}
            active={activeCategory === 'all'}
            onClick={() => setActiveCategory('all')}
          />
          {categories.map((c) => (
            <CategoryChip
              key={c.slug}
              label={c.name}
              count={c.count}
              active={activeCategory === c.slug}
              onClick={() => setActiveCategory(c.slug)}
            />
          ))}
        </nav>
      </div>

      {/* Grid / list */}
      <main className="flex-1 overflow-y-auto p-4">
        {products.isLoading && (
          <div className="text-text-secondary text-sm">Loading stock…</div>
        )}
        {products.isError && (
          <div
            role="alert"
            className="grid place-items-center py-16 px-8 text-center"
          >
            <div className="max-w-sm space-y-3">
              <p className="font-serif text-lg text-text-primary">Stock unavailable</p>
              <p className="text-text-secondary text-sm">
                Could not load display stock. Check the connection and try again.
              </p>
              <Button variant="primary" onClick={() => products.refetch()}>
                Retry
              </Button>
            </div>
          </div>
        )}
        {!products.isLoading && !products.isError && filtered.length === 0 && (
          <EmptyState
            icon={Package}
            title="No products"
            description={
              search
                ? `No products match "${search}" in ${activeCategory === 'all' ? 'any category' : 'this category'}.`
                : 'No products in this category.'
            }
            size="md"
          />
        )}
        {!products.isError &&
          filtered.length > 0 &&
          (viewMode === 'card' ? (
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filtered.map((p) => (
                <POSStockCard
                  key={p.id}
                  product={p}
                  isReceiving={isMutating}
                  onReceive={(qty) => handleReceive(p, qty)}
                  onReturnToKitchen={hasDisplayManage ? (qty) => handleReturnToKitchen(p, qty) : undefined}
                  onWaste={hasDisplayManage ? (qty, reason) => handleWaste(p, qty, reason) : undefined}
                  onAdjust={hasDisplayManage ? (newQty, reason) => handleAdjust(p, newQty, reason) : undefined}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((p) => (
                <POSStockRow
                  key={p.id}
                  product={p}
                  isReceiving={isMutating}
                  onReceive={(qty) => handleReceive(p, qty)}
                  onReturnToKitchen={hasDisplayManage ? (qty) => handleReturnToKitchen(p, qty) : undefined}
                  onWaste={hasDisplayManage ? (qty, reason) => handleWaste(p, qty, reason) : undefined}
                  onAdjust={hasDisplayManage ? (newQty, reason) => handleAdjust(p, newQty, reason) : undefined}
                />
              ))}
            </div>
          ))}
      </main>

      <POSStockCategoriesSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        categories={categories.map((c) => ({
          slug: c.slug,
          name: c.name,
          enabled: enabledCategories === null || enabledCategories.has(c.slug),
        }))}
        onSave={(next) => {
          setEnabledCategories(new Set(next.filter((c) => c.enabled).map((c) => c.slug)));
          setSettingsOpen(false);
        }}
      />
    </div>
  );
}

function KpiChip({
  tone,
  icon,
  label,
}: {
  tone: 'danger' | 'warning' | 'neutral';
  icon?: JSX.Element;
  label: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 h-7 rounded-md text-xs font-semibold uppercase tracking-widest',
        tone === 'danger' && 'bg-red-soft text-red',
        tone === 'warning' && 'bg-amber-warn/10 text-amber-warn',
        tone === 'neutral' && 'bg-bg-overlay text-text-secondary',
      )}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

function ViewToggleButton({
  active,
  label,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  testId: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        'h-9 w-10 inline-flex items-center justify-center transition-colors',
        active ? 'bg-gold-soft text-gold' : 'text-text-secondary hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 h-8 rounded-full border text-xs font-semibold whitespace-nowrap',
        'transition-colors motion-reduce:transition-none',
        active
          ? 'bg-gold-soft border-gold text-gold'
          : 'bg-bg-elevated border-border-subtle text-text-secondary hover:text-text-primary',
      )}
    >
      <span>{label}</span>
      <span className="opacity-80 font-normal">({count})</span>
    </button>
  );
}
