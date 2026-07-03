# ⚠️ STALE — décrit du code NON MONTÉ (2026-07-04)

L'architecture hub/client décrite ici existe dans `apps/pos/src/features/lan/` mais **n'est câblée nulle part en production** (zéro call-site ; heartbeats jamais émis ; file d'impression DB orpheline ; bug de topics suspecté `lan-hub-*` vs `lan-client-*`). Le transport réel est Supabase Realtime (internet) + print-bridge HTTP externe.

État réel et plan : fiche `../../workplan/remise-a-plat/21-lan-architecture.md`. Le sort de ce chapitre dépend de la **décision 2** (internet-first assumé vs réhabilitation du mesh) — cf. `../../workplan/remise-a-plat/00-INDEX.md` §3.
