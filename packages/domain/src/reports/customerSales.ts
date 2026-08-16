// packages/domain/src/reports/customerSales.ts
//
// Constante du rapport « Sales by Customer » — le seuil de DÉCROCHAGE vit dans
// le code (jamais en DB) : le hook la transmet à la RPC en argument
// (p_churn_min_orders), la RPC reste générique. Arbitrage Mamat 2026-08-16.
//
// IO-free, no React, no Supabase.

/** Un client « en décrochage » a fait AU MOINS ce nombre d'achats dans la
 *  fenêtre précédente, et AUCUN dans la fenêtre courante. */
export const CUSTOMER_CHURN_MIN_PREV_ORDERS = 2;
