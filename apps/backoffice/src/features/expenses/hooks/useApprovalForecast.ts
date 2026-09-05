// apps/backoffice/src/features/expenses/hooks/useApprovalForecast.ts
//
// Prévision de la chaîne d'approbation pour un brouillon de dépense.
//
// Cette résolution est un MIROIR de celle que `submit_expense` exécute côté
// serveur, recopiée depuis le corps de la RPC
// (`supabase/migrations/20260524115443_fix_submit_expense_v2_security_hardening.sql`) :
//
//   SELECT steps FROM expense_approval_thresholds
//   WHERE (category_id = <cat> OR category_id IS NULL)
//     AND <amount> >= amount_min
//     AND <amount> <  amount_max
//   ORDER BY category_id NULLS LAST
//   LIMIT 1;
//
// Trois faits qu'on ne devine pas, on les lit :
//  1. l'intervalle est DEMI-OUVERT — `[amount_min, amount_max)`. Un montant
//     égal à `amount_max` tombe dans le palier suivant, pas dans celui-ci ;
//  2. `ORDER BY category_id NULLS LAST` fait gagner la règle de catégorie sur
//     la règle générale, et `set_expense_threshold` interdit deux règles qui
//     se chevauchent POUR UNE MÊME catégorie — donc au plus deux lignes
//     matchent, et laquelle gagne est déterministe ;
//  3. quand AUCUNE ligne ne matche, le serveur ne laisse pas passer : il lève
//     `no threshold matches amount=… category=…`. « Aucune approbation requise »
//     serait un mensonge — c'est `steps = []` qui veut dire auto-approbation.
//
// Le résultat reste une PRÉVISION : l'autorité est au serveur (PRODUCT.md,
// Product Principle « Le serveur est l'autorité, jamais le client »).

import {
  useExpenseThresholds,
  type ApprovalStep,
  type ExpenseThresholdRow,
} from '@/features/settings/expense-thresholds/hooks/useExpenseThresholds.js';

export type ApprovalForecastStatus =
  /** Pas assez d'information pour affirmer quoi que ce soit. */
  | 'pending'
  /** Aucun palier ne couvre ce montant — le serveur REFUSERA la soumission. */
  | 'unconfigured'
  /** Palier trouvé, `steps = []` — approuvée d'office à la soumission. */
  | 'auto-approve'
  /** Palier trouvé, une ou plusieurs étapes d'approbation. */
  | 'chain';

export interface ApprovalForecast {
  status: ApprovalForecastStatus;
  /** La règle que le serveur retiendra, telle qu'elle est en base. */
  matched: ExpenseThresholdRow | null;
  /** La règle générale écartée par une règle de catégorie, le cas échéant. */
  overridden: ExpenseThresholdRow | null;
  steps: ApprovalStep[];
  /** Réserve à afficher À CÔTÉ de la prévision (DESIGN.md § Do's). */
  caveat: string | null;
}

const PENDING: ApprovalForecast = {
  status: 'pending',
  matched: null,
  overridden: null,
  steps: [],
  caveat: null,
};

export interface ApprovalForecastInput {
  categoryId: string;
  /** Montant saisi, déjà parsé. `null` / NaN / <= 0 → aucune affirmation. */
  amount: number | null;
}

/** Résolution pure — testable sans réseau ni React. */
export function resolveApprovalForecast(
  rows: ExpenseThresholdRow[] | undefined,
  input: ApprovalForecastInput,
): ApprovalForecast {
  if (rows === undefined) return PENDING;

  const { categoryId, amount } = input;
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return PENDING;

  // Intervalle demi-ouvert, comme la RPC.
  const covers = (r: ExpenseThresholdRow): boolean =>
    amount >= Number(r.amount_min) && amount < Number(r.amount_max);

  const specific =
    categoryId === ''
      ? undefined
      : rows.find((r) => r.category_id === categoryId && covers(r));
  const general = rows.find((r) => r.category_id === null && covers(r));

  const matched = specific ?? general ?? null;
  const overridden = specific !== undefined && general !== undefined ? general : null;

  // La catégorie non choisie est une réserve, pas une erreur : la règle
  // générale reste celle qui s'appliquerait, mais une règle de catégorie peut
  // encore la remplacer.
  const caveat =
    categoryId === ''
      ? 'No category picked yet — a category rule can still override this.'
      : null;

  if (matched === null) {
    return { status: 'unconfigured', matched: null, overridden: null, steps: [], caveat };
  }

  const steps = Array.isArray(matched.steps) ? matched.steps : [];
  return {
    status: steps.length === 0 ? 'auto-approve' : 'chain',
    matched,
    overridden,
    steps,
    caveat,
  };
}

export interface UseApprovalForecastResult {
  forecast: ApprovalForecast;
  isLoading: boolean;
  isError: boolean;
}

export function useApprovalForecast(input: ApprovalForecastInput): UseApprovalForecastResult {
  const { data, isLoading, isError } = useExpenseThresholds();
  return {
    forecast: resolveApprovalForecast(data, input),
    isLoading,
    isError,
  };
}
