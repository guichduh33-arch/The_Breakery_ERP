// apps/backoffice/src/features/reports/components/DrilldownLink.tsx
//
// Session 31 / Wave 1.B — DrilldownLink composant entity-aware unifié pour
// reports. Wrap les cells drillable des 17 reports BO en <Link> stylé sobre
// ou en <span> plain text si le combo entity+id n'a pas de cible viable.

import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import {
  buildDrilldownUrl,
  type DrilldownEntity,
  type DrilldownFilter,
} from '../utils/buildDrilldownUrl.js';

export interface DrilldownLinkProps {
  entity: DrilldownEntity;
  id: string;
  label: ReactNode;
  filter?: DrilldownFilter;
  icon?: boolean;
  className?: string;
}

const BASE_CLS =
  'inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline';

export function DrilldownLink({
  entity,
  id,
  label,
  filter,
  icon = true,
  className,
}: DrilldownLinkProps): JSX.Element {
  const url = buildDrilldownUrl(entity, id, filter);
  if (!url) {
    return <span className={className}>{label}</span>;
  }
  return (
    <Link to={url} className={className ? `${BASE_CLS} ${className}` : BASE_CLS}>
      {label}
      {icon && <ExternalLink size={12} className="opacity-50" />}
    </Link>
  );
}
