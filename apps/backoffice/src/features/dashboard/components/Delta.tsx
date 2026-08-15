// apps/backoffice/src/features/dashboard/components/Delta.tsx
//
// Lot B (campagne Reports 2026-08-15) — le composant vit désormais en partagé
// (src/components/kpi/Delta.tsx), consommé par le dashboard ET les rapports.
// Ce chemin ré-exporte pour ne pas toucher les cartes du dashboard.

export { Delta, type DeltaProps } from '@/components/kpi/Delta.js';
