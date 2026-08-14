// apps/backoffice/src/features/dashboard/components/DashboardCard.tsx
//
// Lot B (campagne Reports 2026-08-15) — le chrome de carte à quatre états vit
// désormais en partagé (src/components/PanelCard.tsx), consommé par le
// dashboard ET les rapports. Ce chemin ré-exporte pour ne pas toucher les ~8
// cartes du dashboard ni leurs tests.

export {
  PanelCard as DashboardCard,
  LiveMarker,
  type PanelCardProps as DashboardCardProps,
} from '@/components/PanelCard.js';
