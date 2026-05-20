// apps/backoffice/src/features/products/components/ProductsHeader.tsx
//
// Session 14 / Phase 4.B — Top header strip on the Products page.
// Mirrors `product page.jpg`: page title + subtitle on the left, a horizontal
// pill toolbar (Products / Import / Recipes / Modifiers / + New Product) on
// the right.

import { type JSX } from 'react';
import { Box, BookOpen, Plus, Sliders, Upload } from 'lucide-react';
import { Card, CardContent } from '@breakery/ui';

interface Props {
  onNew?:       (() => void) | undefined;
  onImport?:    (() => void) | undefined;
  onRecipes?:   (() => void) | undefined;
  onModifiers?: (() => void) | undefined;
}

export function ProductsHeader({ onNew, onImport, onRecipes, onModifiers }: Props): JSX.Element {
  return (
    <Card variant="default">
      <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gold-soft text-gold">
            <Box className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-2xl text-text-primary">Product Catalog</h1>
            <p className="text-sm text-text-secondary italic">
              Manage your products, prices and customer category pricing
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PillButton icon={<Box className="h-4 w-4" aria-hidden />} label="Products" />
          <PillButton icon={<Upload className="h-4 w-4" aria-hidden />} label="Import" onClick={onImport} />
          <PillButton icon={<BookOpen className="h-4 w-4" aria-hidden />} label="Recipes" onClick={onRecipes} />
          <PillButton icon={<Sliders className="h-4 w-4" aria-hidden />} label="Modifiers" onClick={onModifiers} />
          <button
            type="button"
            onClick={onNew}
            className="inline-flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-sm font-semibold text-bg-base hover:bg-gold-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold transition-colors"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New Product
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

interface PillButtonProps {
  icon:   JSX.Element;
  label:  string;
  onClick?: (() => void) | undefined;
}

function PillButton({ icon, label, onClick }: PillButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-bg-overlay px-4 py-2 text-sm text-text-secondary hover:bg-bg-input hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}
