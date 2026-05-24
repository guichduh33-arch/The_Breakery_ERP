// supabase/functions/_shared/pdf-templates/index.ts
// S29 Wave 3.A.2 — Template registry: maps TemplateName → render fn + required permission.
import { type LayoutContext } from '../pdf-layout.ts';

import * as pnl              from './pnl.ts';
import * as bs               from './bs.ts';
import * as cf               from './cf.ts';
import * as basket           from './basket.ts';
import * as recipeOverview   from './recipe_overview.ts';
import * as recipeTimeline   from './recipe_timeline.ts';
import * as salesByHour      from './sales_by_hour.ts';
import * as salesByCategory  from './sales_by_category.ts';
import * as salesByStaff     from './sales_by_staff.ts';
import * as stockVariance    from './stock_variance.ts';
import * as productionYield  from './production_yield.ts';
import * as audit            from './audit.ts';

export type TemplateName =
  | 'pnl'
  | 'bs'
  | 'cf'
  | 'basket'
  | 'recipe_overview'
  | 'recipe_timeline'
  | 'sales_by_hour'
  | 'sales_by_category'
  | 'sales_by_staff'
  | 'stock_variance'
  | 'production_yield'
  | 'audit';

// deno-lint-ignore no-explicit-any
type RenderFn = (ctx: LayoutContext, data: any, period: { start: string; end: string } | null) => Promise<void>;

export interface TemplateRegistration {
  render:     RenderFn;
  permission: string;
}

export const TEMPLATES: Record<TemplateName, TemplateRegistration> = {
  pnl:               { render: pnl.render,             permission: 'reports.financial.read' },
  bs:                { render: bs.render,              permission: 'reports.financial.read' },
  cf:                { render: cf.render,              permission: 'reports.financial.read' },
  basket:            { render: basket.render,          permission: 'reports.sales.read'     },
  recipe_overview:   { render: recipeOverview.render,  permission: 'reports.financial.read' },
  recipe_timeline:   { render: recipeTimeline.render,  permission: 'reports.financial.read' },
  sales_by_hour:     { render: salesByHour.render,     permission: 'reports.sales.read'     },
  sales_by_category: { render: salesByCategory.render, permission: 'reports.sales.read'     },
  sales_by_staff:    { render: salesByStaff.render,    permission: 'reports.sales.read'     },
  stock_variance:    { render: stockVariance.render,   permission: 'reports.inventory.read' },
  production_yield:  { render: productionYield.render, permission: 'inventory.read'         },
  audit:             { render: audit.render,           permission: 'reports.audit.read'     },
};
