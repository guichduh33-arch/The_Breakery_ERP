// apps/backoffice/src/features/reports/components/salesOrderFilters.tsx
//
// S3-22 — les TROIS filtres de commande des rapports de vente (type, moyen de
// paiement, table), déclarés une seule fois pour toutes les pages qui les
// portent : Sales by Product, Sales by Category, Sales by Staff, Sales by
// Origin, Sales by Customer, Combo Sales. Sales by Table ne porte que le
// moyen de paiement (le type et la table y sont fixés par le rapport). Mêmes
// clés d'URL, mêmes libellés, même réserve de lecture — un lien d'un rapport
// vers un autre transporte donc la portée sans traduction.
//
// Les options dérivent des maps typées sur les enums Postgres
// (`statusMeta`) : aucune valeur n'est recopiée ici.

import type { JSX } from 'react';
import {
  ORDER_TYPES, ORDER_TYPE_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL,
} from '@/features/orders/statusMeta.js';
import type { ReportFilterDef, ReportFilterOption } from '../hooks/useReportFilters.js';
import type { SalesOrderFilters } from '../utils/salesFilters.js';

export type SalesOrderFilterKey = 'order_type' | 'payment_method' | 'table_number';

const ORDER_TYPE_OPTIONS: readonly ReportFilterOption[] =
  ORDER_TYPES.map((t) => ({ value: t, label: ORDER_TYPE_LABEL[t] }));
const PAYMENT_OPTIONS: readonly ReportFilterOption[] =
  PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }));

const PAYMENT_FILTER_DEF: ReportFilterDef<'payment_method'> = {
  kind: 'select', key: 'payment_method', label: 'Payment method', allLabel: 'All payments',
  options: PAYMENT_OPTIONS, strict: true,
};

/** Niveau module : `useReportFilters` met la liste en dépendance. */
export const SALES_ORDER_FILTER_DEFS: readonly ReportFilterDef<SalesOrderFilterKey>[] = [
  {
    kind: 'select', key: 'order_type', label: 'Order type', allLabel: 'All types',
    options: ORDER_TYPE_OPTIONS, strict: true,
  },
  PAYMENT_FILTER_DEF,
  {
    kind: 'text', key: 'table_number', label: 'Table', placeholder: 'Any',
    maxLength: 32, width: 'w-28',
  },
];

/** Le seul filtre de paiement, même définition (Sales by Table). Niveau module. */
export const SALES_PAYMENT_FILTER_DEFS: readonly ReportFilterDef<'payment_method'>[] = [
  PAYMENT_FILTER_DEF,
];

/**
 * Valeurs d'URL → filtres serveur. `find` sur la liste d'enum : la valeur sort
 * typée sans cast, et une valeur hors enum (déjà écartée par `strict`) ne peut
 * pas partir au serveur. Mémoïser l'appel : l'objet entre dans des clés de
 * requête et des dépendances.
 */
export function toSalesOrderFilters(
  values: Readonly<Record<SalesOrderFilterKey, string>>,
): SalesOrderFilters {
  const ot = ORDER_TYPES.find((t) => t === values.order_type);
  const pm = PAYMENT_METHODS.find((m) => m === values.payment_method);
  return {
    ...(ot !== undefined ? { order_type: ot } : {}),
    ...(pm !== undefined ? { payment_method: pm } : {}),
    ...(values.table_number !== '' ? { table_number: values.table_number } : {}),
  };
}

/**
 * Réserve du filtre paiement, à poser sous la barre tant qu'il est actif. Le
 * filtre retient les COMMANDES qui portent ce moyen, pas les montants réglés
 * par lui : une commande mixte compte en entier sous chacun. Il exige une
 * ligne de règlement ; on ne prétend pas savoir quels canaux en ont une.
 */
export function PaymentFilterNote(): JSX.Element {
  return (
    <p className="text-xs text-text-secondary" role="note" data-testid="payment-filter-note">
      An order paid with several methods counts in full under each one, so
      totals per method do not add up. Orders with no recorded payment line
      are left out.
    </p>
  );
}
