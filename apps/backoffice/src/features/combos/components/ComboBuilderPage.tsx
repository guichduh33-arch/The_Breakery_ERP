// apps/backoffice/src/features/combos/components/ComboBuilderPage.tsx
//
// Session 47 — Combo builder: create (/new) + edit (/:comboId/edit).
// Permissions: combos.create (new) / combos.update (edit) gated at route level.
// Inside the form: combos.delete gates the Delete button on edit.
//
// @breakery/ui has no RadioGroup — uses native form controls throughout for uniformity.
// No direct imports from @breakery/ui needed here (Button only in footer).

import { useState, useEffect, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Box, ArrowLeft } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useAllCategories } from '@/features/categories/hooks/useAllCategories.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useComboDetail } from '../hooks/useComboDetail.js';
import { useUpsertCombo } from '../hooks/useUpsertCombo.js';
import { useDeleteCombo } from '../hooks/useDeleteCombo.js';
import { GeneralInfoSection, type GeneralInfoDraft } from './GeneralInfoSection.js';
import { ChoiceGroupCard, type GroupDraft } from './ChoiceGroupCard.js';
import { PricePreview } from './PricePreview.js';
import type { ComboDefinition } from '@breakery/domain';

interface Props {
  mode: 'create' | 'edit';
}

function newGroupId() {
  return crypto.randomUUID();
}

const defaultGeneralInfo = (): GeneralInfoDraft => ({
  name: '',
  description: '',
  category_id: '',
  base_price: 0,
  display_order: 0,
  image_url: '',
  available_from: '',
  available_to: '',
  is_active: true,
  visible_on_pos: true,
});

export default function ComboBuilderPage({ mode }: Props): JSX.Element {
  const navigate = useNavigate();
  const { comboId } = useParams<{ comboId: string }>();

  const canDelete = useAuthStore((s) => s.hasPermission('combos.delete'));

  const detail = useComboDetail(mode === 'edit' ? comboId : undefined);
  const categories = useAllCategories();
  const upsertCombo = useUpsertCombo();
  const deleteCombo = useDeleteCombo();

  const [generalInfo, setGeneralInfo] = useState<GeneralInfoDraft>(defaultGeneralInfo());
  const [groups, setGroups] = useState<GroupDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Populate form when editing an existing combo
  useEffect(() => {
    if (mode === 'edit' && detail.data != null) {
      const d = detail.data;
      setGeneralInfo({
        name: d.name,
        description: d.description ?? '',
        category_id: d.category_id ?? '',
        base_price: d.base_price,
        display_order: d.display_order,
        image_url: d.image_url ?? '',
        available_from: d.available_from ?? '',
        available_to: d.available_to ?? '',
        is_active: d.is_active,
        visible_on_pos: d.visible_on_pos,
      });
      setGroups(
        d.definition.groups.map((g) => ({
          id: g.id,
          name: g.name,
          group_type: g.group_type,
          is_required: g.is_required,
          min_select: g.min_select,
          max_select: g.max_select,
          sort_order: g.sort_order,
          options: g.options.map((o) => ({
            component_product_id: o.component_product_id,
            label: o.label,
            surcharge: o.surcharge,
            is_default: o.is_default,
            sort_order: o.sort_order,
          })),
        })),
      );
    }
  }, [mode, detail.data]);

  function handleAddGroup() {
    const newGroup: GroupDraft = {
      id: newGroupId(),
      name: '',
      group_type: 'single',
      is_required: true,
      min_select: 1,
      max_select: 1,
      sort_order: groups.length,
      options: [],
    };
    setGroups([...groups, newGroup]);
  }

  function handleGroupChange(idx: number, updated: GroupDraft) {
    setGroups(groups.map((g, i) => (i === idx ? updated : g)));
  }

  function handleRemoveGroup(idx: number) {
    setGroups(groups.filter((_, i) => i !== idx));
  }

  function validate(): string | null {
    if (generalInfo.name.trim().length < 2) return 'Name must be at least 2 characters.';
    if (!generalInfo.category_id) return 'Category is required.';
    if (generalInfo.base_price <= 0) return 'Base price must be greater than 0.';
    for (const g of groups) {
      if (g.name.trim().length === 0) return `A group has an empty name — please fill it in.`;
      if (g.options.length === 0) return `Group "${g.name}" has no options — add at least one product.`;
      if (g.group_type === 'single') {
        const defaultCount = g.options.filter((o) => o.is_default).length;
        if (defaultCount !== 1) return `Group "${g.name}" must have exactly one default option (found ${defaultCount}).`;
      }
    }
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err !== null) {
      setFormError(err);
      return;
    }
    setFormError(null);
    try {
      await upsertCombo.mutateAsync({
        combo_product_id: mode === 'edit' && comboId !== undefined ? comboId : null,
        sku: null,
        name: generalInfo.name.trim(),
        description: generalInfo.description.trim() || null,
        image_url: generalInfo.image_url.trim() || null,
        category_id: generalInfo.category_id,
        base_price: generalInfo.base_price,
        display_order: generalInfo.display_order,
        available_from: generalInfo.available_from || null,
        available_to: generalInfo.available_to || null,
        is_active: generalInfo.is_active,
        visible_on_pos: generalInfo.visible_on_pos,
        groups: groups.map((g, gIdx) => ({
          name: g.name.trim(),
          group_type: g.group_type,
          is_required: g.is_required,
          min_select: g.min_select,
          max_select: g.max_select,
          sort_order: gIdx,
          options: g.options.map((o, oIdx) => ({
            component_product_id: o.component_product_id,
            surcharge: o.surcharge,
            is_default: o.is_default,
            sort_order: oIdx,
          })),
        })),
      });
      toast.success(mode === 'create' ? 'Combo created!' : 'Combo updated!');
      navigate('/backoffice/products/combos');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDelete() {
    if (!comboId) return;
    const confirmed = window.confirm(
      `Delete combo "${generalInfo.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await deleteCombo.mutateAsync(comboId);
      toast.success('Combo deleted.');
      navigate('/backoffice/products/combos');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // Build a live ComboDefinition for PricePreview
  const liveDefinition: ComboDefinition = {
    combo_product_id: comboId ?? '',
    name: generalInfo.name,
    base_price: generalInfo.base_price,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      group_type: g.group_type,
      is_required: g.is_required,
      min_select: g.min_select,
      max_select: g.max_select,
      sort_order: g.sort_order,
      options: g.options.map((o) => ({
        id: o.component_product_id,
        component_product_id: o.component_product_id,
        label: o.label,
        surcharge: o.surcharge,
        is_default: o.is_default,
        sort_order: o.sort_order,
      })),
    })),
  };

  const isLoading = mode === 'edit' && detail.isLoading;
  const isSaving = upsertCombo.isPending || deleteCombo.isPending;

  return (
    <div className="space-y-6 pb-20">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => { navigate('/backoffice/products/combos'); }}
          className="text-text-muted hover:text-text-primary transition-colors"
          aria-label="Back to Combo Management"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gold-soft text-gold">
          <Box className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl text-text-primary">
            {mode === 'create' ? 'New Combo' : 'Edit Combo'}
          </h1>
          <p className="text-xs italic text-text-secondary">
            {mode === 'create'
              ? 'Build a configurable combo bundle'
              : `Editing: ${generalInfo.name || '…'}`}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse rounded-lg border border-border-subtle bg-bg-overlay h-40" />
      ) : (
        <>
          {/* General Info */}
          <div className="rounded-lg border border-border-subtle bg-bg-elevated p-6">
            <GeneralInfoSection
              draft={generalInfo}
              categories={categories.data ?? []}
              onChange={(patch) => { setGeneralInfo((prev) => ({ ...prev, ...patch })); }}
            />
          </div>

          {/* Live price preview */}
          <PricePreview definition={liveDefinition} />

          {/* Choice groups */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-text-secondary">
                Choice Groups
              </h2>
              <button
                type="button"
                onClick={handleAddGroup}
                className="flex items-center gap-1.5 text-xs text-gold hover:text-gold-hover transition-colors"
                data-testid="add-group"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add Group
              </button>
            </div>

            {groups.length === 0 && (
              <p className="text-sm italic text-text-muted px-1">
                No choice groups yet. Add a group to configure selectable options.
              </p>
            )}

            {groups.map((g, idx) => (
              <ChoiceGroupCard
                key={g.id}
                group={g}
                onChange={(updated) => { handleGroupChange(idx, updated); }}
                onRemove={() => { handleRemoveGroup(idx); }}
              />
            ))}
          </div>

          {/* Validation error */}
          {formError !== null && (
            <div
              className="rounded-lg border border-red bg-red-soft p-3 text-sm text-red"
              role="alert"
              data-testid="form-error"
            >
              {formError}
            </div>
          )}
        </>
      )}

      {/* Footer actions */}
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-border-subtle bg-bg-base px-6 py-4 flex items-center justify-between gap-4">
        <div>
          {mode === 'edit' && canDelete && (
            <Button
              variant="ghostDestructive"
              onClick={() => { void handleDelete(); }}
              disabled={isSaving}
              data-testid="delete-combo"
            >
              Delete
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={() => { navigate('/backoffice/products/combos'); }}
            disabled={isSaving}
            data-testid="cancel-combo"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => { void handleSave(); }}
            disabled={isSaving || isLoading}
            data-testid="save-combo"
          >
            {isSaving ? 'Saving…' : mode === 'create' ? 'Create Combo' : 'Update Combo'}
          </Button>
        </div>
      </div>
    </div>
  );
}
