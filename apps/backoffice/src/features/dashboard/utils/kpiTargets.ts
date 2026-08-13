// apps/backoffice/src/features/dashboard/utils/kpiTargets.ts
//
// Écran 1c — où mène chaque chiffre de la bande KPI.
//
// Un dashboard qui affiche « Rp 8,42 jt » sans dire d'où ça vient laisse le
// gérant devant un cul-de-sac : il voit le chiffre, il ne peut pas le vérifier.
// Ce module donne à chaque tuile la page qui PORTE sa mesure, avec la MÊME
// fenêtre temporelle — une tuile du jour ouvre le jour, pas les 30 derniers.
//
// Trois règles gouvernent la table ci-dessous, et la troisième explique les
// deux `null` :
//
//  1. La cible porte la même fenêtre que la tuile. Les pages de rapport lisent
//     `start`/`end` en URL-state (`useUrlState`, convention S57), la liste des
//     commandes aussi — l'URL suffit donc à transmettre la journée.
//  2. La cible porte sa permission de route. Un lien vers un écran que le rôle
//     n'a pas le droit d'ouvrir renvoie sur `/backoffice` par `PermissionGate` :
//     c'est un lien qui ment. Le composant filtre sur `hasPermission`, comme la
//     barre de raccourcis de la page le fait déjà.
//  3. Pas de cible fidèle ⇒ pas de lien. Une tuile inerte est honnête ; une
//     tuile qui débarque sur un chiffre DIFFÉRENT du sien détruit la confiance
//     qu'elle prétendait construire. D'où :
//       · `customers` — la mesure est « clients distincts servis aujourd'hui,
//         anonymes exclus ». Aucun écran ne liste les acheteurs d'une journée :
//         la fiche clients n'a aucun filtre de date (elle n'appelle même pas
//         `useSearchParams`). Rien à ouvrir sans mentir.
//       · `gross_margin` — la tuile est calculée au COÛT COURANT (réserve
//         gravée dans la migration 20260806000001, rappelée sous la bande) ;
//         le rapport « Gross Margin » calcule au COGS/WAC. Deux méthodes, deux
//         nombres. Cliquer sur 61,8 % pour atterrir sur 58,2 % est exactement
//         le lien qui ment.

import type { PermissionCode } from '@breakery/supabase';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';

export interface KpiTarget {
  /** Destination, fenêtre temporelle de la tuile comprise. */
  href: string;
  /** Permission exigée par la route cible (`routes/index.tsx`). */
  permission: PermissionCode;
  /**
   * Complément lu par le lecteur d'écran APRÈS la valeur. Un `aria-label`
   * écraserait le contenu de la tuile — le chiffre disparaîtrait de la
   * restitution vocale, ce qui est le contraire du but.
   */
  hint: string;
}

export type KpiTargetKey =
  | 'net_revenue'
  | 'orders'
  | 'customers'
  | 'items_sold'
  | 'avg_basket'
  | 'gross_margin'
  | 'cash_on_hand';

export type KpiTargets = Record<KpiTargetKey, KpiTarget | null>;

/** Fenêtre `start`/`end` accrochée à une route de rapport. */
function withWindow(base: string, start: string, end: string): string {
  const params = new URLSearchParams({ start, end });
  return `${base}?${params.toString()}`;
}

/**
 * Table des cibles pour un jour métier donné (`YYYY-MM-DD`).
 *
 * Le jour est un PARAMÈTRE : aucun calcul de fuseau ici. L'appelant passe la
 * date locale du poste, exactement comme chaque page de rapport calcule sa
 * propre valeur par défaut (`toLocalDateStr(new Date())`) — le fuseau métier
 * est une constante de déploiement posée côté base (ADR-019), pas quelque
 * chose que le client recalcule.
 */
export function buildKpiTargets(today: string): KpiTargets {
  const dailySalesToday = withWindow('/backoffice/reports/daily-sales', today, today);

  return {
    // La journée en gross / refunds / net : la tuile EST une ligne de ce tableau.
    net_revenue: {
      href: dailySalesToday,
      permission: 'reports.sales.read',
      hint: 'Open Daily Sales for today',
    },

    // Entité `order_list` du helper de drill-down des rapports : mêmes clés
    // `start`/`end` que celles que la liste des commandes lit dans l'URL.
    orders: {
      href: buildDrilldownUrl('order_list', '', { start: today, end: today })
        ?? '/backoffice/orders',
      permission: 'orders.read',
      hint: "Open today's orders",
    },

    // Voir règle 3 en tête de fichier.
    customers: null,

    // Le décompte du jour, ventilé par catégorie : « Sales by Category » rend
    // revenue ET quantité, la quantité étant précisément ce que la tuile somme.
    items_sold: {
      href: withWindow('/backoffice/reports/sales-by-category', today, today),
      permission: 'reports.sales.read',
      hint: 'Open Sales by Category for today',
    },

    // Même page que le CA : la colonne AOV du jour est la tuile, au même
    // dénominateur. « Basket Analysis » porte un autre sens du mot panier
    // (paires de produits achetées ensemble) et n'aurait pas ce chiffre.
    avg_basket: {
      href: dailySalesToday,
      permission: 'reports.sales.read',
      hint: 'Open Daily Sales for today',
    },

    // Voir règle 3 en tête de fichier.
    gross_margin: null,

    // Solde, pas un flux : aucune fenêtre à transmettre. Entité `cash_treasury`
    // du helper de drill-down.
    cash_on_hand: {
      href: buildDrilldownUrl('cash_treasury', '') ?? '/backoffice/accounting/cash',
      permission: 'accounting.cash.read',
      hint: 'Open cash & treasury',
    },
  };
}

/**
 * Fenêtre du graphe « Revenue · 30 days » — 30 jours glissants, bornes
 * incluses, soit J-29 → J. C'est aussi la fenêtre par défaut de la page Daily
 * Sales : le lien ouvre donc le même intervalle que celui qui est tracé.
 */
export function revenue30dTarget(today: string, start: string): KpiTarget {
  return {
    href: withWindow('/backoffice/reports/daily-sales', start, today),
    permission: 'reports.sales.read',
    hint: 'Open Daily Sales for the last 30 days',
  };
}
