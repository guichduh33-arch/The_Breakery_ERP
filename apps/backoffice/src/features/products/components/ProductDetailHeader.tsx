// apps/backoffice/src/features/products/components/ProductDetailHeader.tsx
//
// Session 14 / Phase 4.B — Top header for the product detail screens.
// Mirrors `Product detail1.jpg`: back button + name + SKU pill on the left,
// "Save changes" CTA on the right.

import { ArrowLeft, Save } from 'lucide-react';
import type { JSX } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  name:    string;
  sku:     string;
  isDirty?: boolean;
  onSave?:  () => void;
}

export function ProductDetailHeader({ name, sku, isDirty = false, onSave }: Props): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <Link
          to="/backoffice/products"
          aria-label="Back to products"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle bg-bg-elevated text-text-secondary hover:bg-bg-overlay hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <div>
          <h1 className="font-display text-3xl text-text-primary">{name}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-text-secondary">
            <span className="uppercase tracking-widest">SKU Identity:</span>
            <span className="rounded-full bg-gold-soft px-2 py-0.5 font-mono font-semibold text-gold">{sku}</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={!isDirty || onSave === undefined}
        className="inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-bg-base hover:bg-gold-hover disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold transition-colors"
      >
        <Save className="h-4 w-4" aria-hidden />
        Save Changes
      </button>
    </div>
  );
}
