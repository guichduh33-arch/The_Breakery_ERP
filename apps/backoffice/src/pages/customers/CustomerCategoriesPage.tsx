// apps/backoffice/src/pages/customers/CustomerCategoriesPage.tsx
//
// Session 14 / Phase 5.B — Customer Categories management page.
//
// Mirrors docs/Design/backoffice/customer category.jpg : a 4-up card grid,
// each card shows the category icon (colored bubble), name, slug, pricing
// type pill, optional description, and active state badge.
//
// S69 Volet A (Task 3) — CRUD activated: create_customer_category_v1 /
// update_customer_category_v1 / delete_customer_category_v1 (migration
// 20260710000135) close deviation D-W6-CUSTCAT-01. New/Edit open
// CategoryFormModal; Delete confirms then mutates, surfacing
// classifyCategoryError (esp. category_in_use).

import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Crown,
  PenSquare,
  Plus,
  ShieldCheck,
  Store,
  Tag,
  Trash2,
  Users as UsersIcon,
  Briefcase,
  type LucideIcon,
} from 'lucide-react';
import { Button, Card, EmptyState, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
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

const ICON_BY_SLUG: Record<string, LucideIcon> = {
  retail:    UsersIcon,
  general:   UsersIcon,
  wholesale: Briefcase,
  vip:       Crown,
  staff:     ShieldCheck,
  asap:      UsersIcon,
  enak:      Store,
};

const TONE_BY_SLUG: Record<string, string> = {
  retail:    'bg-cat-blue',
  general:   'bg-cat-blue',
  wholesale: 'bg-cat-emerald',
  vip:       'bg-cat-amber',
  staff:     'bg-cat-violet',
  asap:      'bg-cat-rose',
  enak:      'bg-cat-indigo',
};

function pricingLabel(cat: CustomerCategoryRow): string {
  switch (cat.price_modifier_type) {
    case 'wholesale':           return 'Wholesale Price';
    case 'discount_percentage': return 'Discount %';
    case 'custom':              return 'Custom Price';
    case 'retail':
    default:                    return 'Standard Price';
  }
}

type EditTarget = 'new' | CustomerCategoryRow;

export default function CustomerCategoriesPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('customer_categories.read');
  const canCreate = hasPermission('customer_categories.create');
  const canUpdate = hasPermission('customer_categories.update');
  const canDelete = hasPermission('customer_categories.delete');

  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerCategoryRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const cats = useCustomerCategories();
  const createCat = useCreateCustomerCategory();
  const updateCat = useUpdateCustomerCategory();
  const deleteCat = useDeleteCustomerCategory();

  if (!canRead) {
    return <div className="text-text-secondary">No access to customer categories.</div>;
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
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button asChild variant="ghost" size="sm" aria-label="Back to customers">
            <Link to="/backoffice/customers">
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <div>
            <h1 className="font-serif text-3xl text-text-primary inline-flex items-center gap-2">
              <Tag className="h-6 w-6 text-gold" aria-hidden /> Customer Categories
            </h1>
            <p className="mt-1 text-sm text-text-secondary">Manage categories and their pricing</p>
          </div>
        </div>
        <Button
          variant="primary"
          size="md"
          disabled={!canCreate}
          onClick={() => { setFormError(null); setEditTarget('new'); }}
        >
          <Plus className="h-4 w-4" aria-hidden /> New Category
        </Button>
      </header>

      {cats.isLoading ? (
        <div className="text-sm text-text-secondary">Loading categories…</div>
      ) : cats.error !== null && cats.error !== undefined ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          Failed: {String(cats.error)}
        </div>
      ) : (cats.data ?? []).length === 0 ? (
        <EmptyState icon={Tag} title="No categories" description="Seed customer categories appear here." size="md" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(cats.data ?? []).map((cat) => (
            <CategoryCard
              key={cat.id}
              cat={cat}
              canUpdate={canUpdate}
              canDelete={canDelete}
              onEdit={() => { setFormError(null); setEditTarget(cat); }}
              onDelete={() => { setDeleteError(null); setDeleteTarget(cat); }}
            />
          ))}
        </div>
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
            <div role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
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

function CategoryCard({
  cat, canUpdate, canDelete, onEdit, onDelete,
}: {
  cat: CustomerCategoryRow;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const Icon = ICON_BY_SLUG[cat.slug] ?? UsersIcon;
  const tone = TONE_BY_SLUG[cat.slug] ?? 'bg-text-secondary';
  return (
    <Card variant="default" padding="md" className="flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div
          aria-hidden
          className={['flex h-10 w-10 items-center justify-center rounded-md text-white', tone].join(' ')}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={!canUpdate} aria-label={`Edit ${cat.name}`} onClick={onEdit}>
            <PenSquare className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            variant="ghost" size="sm"
            disabled={!canDelete || cat.is_default}
            aria-label={`Delete ${cat.name}`}
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <div>
        <div className="font-serif text-lg leading-tight text-text-primary">{cat.name}</div>
        <span className="mt-1 inline-flex rounded bg-bg-overlay px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
          {cat.slug}
        </span>
      </div>

      <div className="rounded-md border border-border-subtle bg-bg-base/40 px-3 py-2 text-sm text-text-primary">
        <div className="font-medium">{pricingLabel(cat)}</div>
        {cat.price_modifier_type === 'discount_percentage' && (
          <div className="mt-0.5 text-xs text-text-secondary">
            <span className="font-mono">%</span> {cat.discount_percentage}% discount
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">
          {cat.is_default ? 'Default' : ' '}
        </span>
        <span
          className={[
            'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest',
            cat.is_active
              ? 'bg-success/15 text-success'
              : 'bg-bg-overlay text-text-secondary',
          ].join(' ')}
        >
          {cat.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
    </Card>
  );
}
