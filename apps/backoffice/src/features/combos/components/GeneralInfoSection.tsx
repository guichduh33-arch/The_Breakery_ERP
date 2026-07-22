// apps/backoffice/src/features/combos/components/GeneralInfoSection.tsx
//
// Session 47 — General Information section for the combo builder.
// Native HTML form controls kept for uniformity with this hand-styled form
// (converting a lone field to the @breakery/ui Select primitive would break its internal rhythm).

import type { JSX } from 'react';
import type { CategoryRow } from '@/features/categories/hooks/useAllCategories.js';

export interface GeneralInfoDraft {
  name: string;
  description: string;
  category_id: string;
  base_price: number;
  display_order: number;
  image_url: string;
  is_active: boolean;
  visible_on_pos: boolean;
}

interface Props {
  draft: GeneralInfoDraft;
  categories: CategoryRow[];
  onChange: (patch: Partial<GeneralInfoDraft>) => void;
}

export function GeneralInfoSection({ draft, categories, onChange }: Props): JSX.Element {
  const inputCls =
    'w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded focus:outline-none focus:ring-1 focus:ring-gold';
  const labelCls = 'block text-[10px] uppercase tracking-wider text-text-secondary mb-1';

  return (
    <section className="space-y-4" data-testid="general-info-section">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-text-secondary border-b border-border-subtle pb-2">
        General Information
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="combo-name" className={labelCls}>
            Name <span className="text-red">*</span>
          </label>
          <input
            id="combo-name"
            value={draft.name}
            onChange={(e) => { onChange({ name: e.target.value }); }}
            placeholder="e.g. Morning Set"
            className={inputCls}
            data-testid="combo-name"
            required
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="combo-description" className={labelCls}>
            Description
          </label>
          <textarea
            id="combo-description"
            value={draft.description}
            onChange={(e) => { onChange({ description: e.target.value }); }}
            rows={2}
            placeholder="Short description…"
            className={inputCls + ' resize-none'}
            data-testid="combo-description"
          />
        </div>

        <div>
          <label htmlFor="combo-category" className={labelCls}>
            Category <span className="text-red">*</span>
          </label>
          <select
            id="combo-category"
            value={draft.category_id}
            onChange={(e) => { onChange({ category_id: e.target.value }); }}
            className={inputCls}
            data-testid="combo-category"
            required
          >
            <option value="">— Select category —</option>
            {categories
              .filter((c) => c.category_type === 'finished')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor="combo-base-price" className={labelCls}>
            Base Price (IDR) <span className="text-red">*</span>
          </label>
          <input
            id="combo-base-price"
            type="number"
            min={0}
            step={1000}
            value={draft.base_price}
            onChange={(e) => { onChange({ base_price: Math.max(0, Number(e.target.value)) }); }}
            className={inputCls}
            data-testid="combo-base-price"
            required
          />
        </div>

        <div>
          <label htmlFor="combo-display-order" className={labelCls}>
            Display Order
          </label>
          <input
            id="combo-display-order"
            type="number"
            min={0}
            value={draft.display_order}
            onChange={(e) => { onChange({ display_order: Math.max(0, Number(e.target.value)) }); }}
            className={inputCls}
            data-testid="combo-display-order"
          />
        </div>

        <div>
          <label htmlFor="combo-image-url" className={labelCls}>
            Image URL
          </label>
          <input
            id="combo-image-url"
            type="url"
            value={draft.image_url}
            onChange={(e) => { onChange({ image_url: e.target.value }); }}
            placeholder="https://…"
            className={inputCls}
            data-testid="combo-image-url"
          />
        </div>

        {/* ADR-007 déc. 3 — les champs Available From/To sont retirés :
            fenêtre horaire fantôme (jamais lue), le besoin happy-hour est
            couvert par les promotions (ADR-006 déc. 10). */}

        <div className="flex flex-wrap gap-6 sm:col-span-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(e) => { onChange({ is_active: e.target.checked }); }}
              className="accent-gold"
              data-testid="combo-is-active"
            />
            <span className="text-sm text-text-secondary">Active</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.visible_on_pos}
              onChange={(e) => { onChange({ visible_on_pos: e.target.checked }); }}
              className="accent-gold"
              data-testid="combo-visible-on-pos"
            />
            <span className="text-sm text-text-secondary">Show in POS</span>
          </label>
        </div>
      </div>
    </section>
  );
}
