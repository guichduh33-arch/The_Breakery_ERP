// apps/backoffice/src/features/suppliers/components/chartTitle.ts
//
// Le titre d'une carte de graphique du domaine fournisseurs — UNE signature,
// six emplois (SupplierAnalyticsTab ×4, SupplierPaymentDistribution,
// SupplierPriceEvolutionTab).
//
// Les six portaient `font-display text-base`, une classe qui MENT : sous
// `.theme-backoffice`, `--font-display` est remappé sur la pile du corps, donc
// elle ne produit aucun serif. Le rôle réel de ces titres est **Title** au sens
// de DESIGN.md § Typography — mono, 600, 12 px, capitales interlettrées — et
// c'est `SectionLabel` qui le rend. La chaîne recopie celle de `PanelCard`,
// qui est le titre de carte canonique du back-office ; elle vit ici pour que
// les six ne divergent pas au prochain passage.
//
// `mb-3` est conservé : c'est la gouttière titre→graphique d'origine.
export const CHART_TITLE = 'mb-3 font-data text-xs font-semibold text-text-primary';
