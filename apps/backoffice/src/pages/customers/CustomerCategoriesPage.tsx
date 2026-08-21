// apps/backoffice/src/pages/customers/CustomerCategoriesPage.tsx
//
// Catégories clients — instance de l'archétype LIST (table dense).
//
// La grille de cartes 4-up cède à la table : une catégorie se lit en une
// ligne (nom, slug, règle de prix, statut), se compare à ses voisines
// colonne par colonne, et porte ses actions en bout de ligne. La bande de
// compteurs filtre par état — jeu borné, comptage en mémoire légitime au
// sens de l'ADR-024. Le serif et les bulles d'icônes décoratives meurent
// avec la refonte ; la pastille de couleur reste : c'est l'identité de la
// catégorie (famille cat-*), pas un ornement.
//
// CRUD inchangé (S69 Volet A) : create/update/delete_customer_category via
// CategoryFormModal + dialogue de confirmation, erreurs classées par
// classifyCategoryError (esp. category_in_use).

import { useMemo, useState, type JSX } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { PenSquare, Trash2 } from 'lucide-react';
import {
  cn,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  type DataTableColumn,
} from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { PageHeader } from '@/components/PageHeader.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import {
  useCustomerCategories,
  type CustomerCategoryRow,
} from '@/features/customers/hooks/useCustomerCategories.js';
import {
  useCreateCustomerCategory,
  useUpdateCustomerCategory,
  useDeleteCustomerCategory,
  classifyCategoryError,
  type CategoryInput,
} from '@/features/customers/hooks/useCustomerCategoryMutations.js';
import { CategoryFormModal } from '@/features/customers/components/CategoryFormModal.js';

const TONE_BY_SLUG: Record<string, string> = {
  retail:    'bg-cat-blue',
  general:   'bg-cat-blue',
  wholesale: 'bg-cat-emerald',
  vip:       'bg-cat-amber',
  staff:     'bg-cat-violet',
  asap:      'bg-cat-rose',
  enak:      'bg-cat-indigo',
};

const BADGE = 'inline-flex rounded-sm px-1.5 py-0.5 font-data text-xs font-semibold uppercase tracking-widest';

function pricingLabel(cat: CustomerCategoryRow): string {
  switch (cat.price_modifier_type) {
    case 'wholesale':           return 'Wholesale price';
    case 'discount_percentage': return 'Discount %';
    case 'custom':              return 'Custom price';
    case 'retail':
    default:                    return 'Standard price';
  }
}

type EditTarget = 'new' | CustomerCategoryRow;
type StateBucket = 'all' | 'active' | 'inactive';

export default function CustomerCategoriesPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('customer_categories.read');
  const canCreate = hasPermission('customer_categories.create');
  const canUpdate = hasPermission('customer_categories.update');
  const canDelete = hasPermission('customer_categories.delete');

  const [bucket, setBucket] = useState<StateBucket>('all');
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerCategoryRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const cats = useCustomerCategories();
  const createCat = useCreateCustomerCategory();
  const updateCat = useUpdateCustomerCategory();
  const deleteCat = useDeleteCustomerCategory();

  const all = useMemo(() => cats.data ?? [], [cats.data]);
  const rows = useMemo(() => {
    if (bucket === 'active') return all.filter((c) => c.is_active);
    if (bucket === 'inactive') return all.filter((c) => !c.is_active);
    return all;
  }, [all, bucket]);

  const counters = useMemo<ListCounter[]>(() => [
    { id: 'all', label: 'All categories', value: all.length, onSelect: () => setBucket('all') },
    { id: 'active', label: 'Active', value: all.filter((c) => c.is_active).length, onSelect: () => setBucket('active') },
    {
      id: 'inactive',
      label: 'Inactive',
      value: all.filter((c) => !c.is_active).length,
      title: 'Hidden from the POS category picker; existing customers keep their assignment.',
      onSelect: () => setBucket('inactive'),
    },
  ], [all]);

  const columns = useMemo<readonly DataTableColumn<CustomerCategoryRow>[]>(() => [
    {
      id: 'name', header: 'Category',
      render: (cat) => (
        <span className="flex items-center gap-2.5">
          {/* Pastille d'identité de catégorie — famille cat-*. */}
          <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', TONE_BY_SLUG[cat.slug] ?? 'bg-text-subtle')} />
          <span className="font-medium text-text-primary">{cat.name}</span>
          {cat.is_default && (
            <span className={cn(BADGE, 'bg-surface-4 text-text-muted')} title="Assigned to new customers by default — cannot be deleted.">
              Default
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'slug', header: 'Slug', width: '8rem',
      render: (cat) => <span className="font-data text-xs text-text-secondary">{cat.slug}</span>,
    },
    {
      id: 'pricing', header: 'Pricing rule', width: '12rem',
      render: (cat) => (
        <span className="text-text-secondary">
          {pricingLabel(cat)}
          {cat.price_modifier_type === 'discount_percentage' && (
            <span className="ml-1.5 font-data tabular-nums text-text-primary">−{cat.discount_percentage}%</span>
          )}
        </span>
      ),
    },
    {
      id: 'loyalty', header: 'Loyalty', width: '7rem',
      render: (cat) => (
        cat.loyalty_enabled
          ? <span className="font-data tabular-nums text-text-secondary">×{cat.points_multiplier}</span>
          : <span className="text-text-subtle" aria-hidden>—</span>
      ),
    },
    {
      id: 'status', header: 'Status', width: '6.5rem',
      render: (cat) => (
        <span className={cn(BADGE, cat.is_active ? 'bg-success-soft text-success' : 'bg-surface-4 text-text-muted')}>
          {cat.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      id: 'actions', header: <span className="sr-only">Row actions</span>, align: 'right', width: '6rem',
      render: (cat) => (
        <span className="inline-flex items-center gap-1.5">
          <button
            type="button"
            aria-label={`Edit ${cat.name}`}
            title={`Edit ${cat.name}`}
            disabled={!canUpdate}
            onClick={() => { setFormError(null); setEditTarget(cat); }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-text-subtle transition-colors hover:bg-surface-4 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            <PenSquare className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Delete ${cat.name}`}
            title={cat.is_default ? 'The default category cannot be deleted.' : `Delete ${cat.name}`}
            disabled={!canDelete || cat.is_default}
            onClick={() => { setDeleteError(null); setDeleteTarget(cat); }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-text-subtle transition-colors hover:bg-red-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </span>
      ),
    },
  ], [canUpdate, canDelete]);

  if (!canRead) {
    return (
      <div className="flex flex-col gap-[13px]">
        <PageHeader title="Customer categories" />
        <p role="status" className="rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm text-text-secondary">
          You do not have permission to view customer categories. Ask an administrator
          for the <span className="font-data"> customer_categories.read </span> permission.
        </p>
      </div>
    );
  }

  function handleSubmit(input: CategoryInput): void {
    setFormError(null);
    if (editTarget === 'new') {
      createCat.mutate(input, {
        onSuccess: () => setEditTarget(null),
        onError: (e) => setFormError(classifyCategoryError(e)),
      });
    } else if (editTarget !== null) {
      updateCat.mutate({ ...input, id: editTarget.id }, {
        onSuccess: () => setEditTarget(null),
        onError: (e) => setFormError(classifyCategoryError(e)),
      });
    }
  }

  function handleDelete(): void {
    if (deleteTarget === null) return;
    setDeleteError(null);
    deleteCat.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
      onError: (e) => setDeleteError(classifyCategoryError(e)),
    });
  }

  return (
    <div className="flex flex-col gap-[13px]">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>Sales</span>
        <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
        <span className="text-text-secondary">Customer categories</span>
      </nav>

      <PageHeader
        title="Customer categories"
        subtitle="Each category names a pricing rule the server applies — the POS never decides a price."
        actions={
          <button
            type="button"
            className={TOOLBAR_BTN_PRIMARY}
            disabled={!canCreate}
            onClick={() => { setFormError(null); setEditTarget('new'); }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> New Category
          </button>
        }
      />

      <ListCounterStrip
        counters={counters}
        activeId={bucket}
        ariaLabel="Category state filters"
        data-testid="categories-counters"
      />

      {cats.error !== null && cats.error !== undefined ? (
        <p role="alert" className="rounded-md border border-red bg-red-soft p-4 text-sm text-red-as-text">
          Categories could not be loaded.{' '}
          <button type="button" className="underline" onClick={() => { void cats.refetch(); }}>
            Try again
          </button>
        </p>
      ) : (
        <DataTable
          caption="Category, slug, pricing rule, loyalty setting and status per customer category"
          columns={columns}
          rows={rows}
          getRowKey={(c) => c.id}
          isLoading={cats.isLoading}
          density="compact"
          emptyTitle="No category here"
          emptyDescription={
            bucket === 'all'
              ? 'Seed customer categories appear here.'
              : 'No category in this state. Pick another counter above.'
          }
          data-testid="categories-table"
          footer={
            <span className="font-data text-xs tabular-nums text-text-muted">
              {rows.length} of {all.length}
            </span>
          }
        />
      )}

      <CategoryFormModal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        initial={editTarget !== null && editTarget !== 'new' ? editTarget : undefined}
        onSubmit={handleSubmit}
        pending={createCat.isPending || updateCat.isPending}
        errorText={formError}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md" data-testid="delete-category-dialog">
          <DialogHeader>
            <DialogTitle>Delete category</DialogTitle>
            <DialogDescription>
              Delete <strong className="text-text-primary">{deleteTarget?.name}</strong>? Customers
              still assigned to this category will block the deletion.
            </DialogDescription>
          </DialogHeader>
          {deleteError !== null && (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {deleteError}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteCat.isPending}>Cancel</Button>
            <Button
              variant="ghostDestructive"
              onClick={handleDelete}
              disabled={deleteCat.isPending}
              data-testid="delete-category-confirm"
            >
              {deleteCat.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
