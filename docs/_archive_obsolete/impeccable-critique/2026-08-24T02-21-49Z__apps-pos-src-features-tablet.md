---
target: tab pos (surface tablette Waiter)
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-08-24T02-21-49Z
slug: apps-pos-src-features-tablet
---
# Critique design — POS tablette (Waiter), apps/pos/src/features/tablet

Method: dual-agent (A: pos-specialist · B: general-purpose). Detector: 1 finding, FP certain (assertion négative de test) → 0 réel. Browser: skipped (route auth-gated PIN, no dev server).

## Design Health Score

| # | Heuristique | Score | Constat clé |
|---|---|---|---|
| 1 | Visibilité de l'état système | 3 | Pastille 3 états, « Sending… », minuteurs. Mais « No tables configured » affiché pendant le chargement (FloorPlanView.tsx:188) |
| 2 | Correspondance monde réel | 3 | Statuts humanisés. Mais toast.error sert le message serveur brut (TabletOrderPage.tsx:186) |
| 3 | Contrôle et liberté | 2 | Pas de retour « All » après une catégorie ; envoi irréversible sans mention |
| 4 | Cohérence et standards | 2 | Tuile sans état « déjà au panier » ; steppers hors kit |
| 5 | Prévention des erreurs | 2 | dine_in + table nulle par défaut = invalide par construction ; refus au dernier tap |
| 6 | Reconnaître > se rappeler | 2 | Rien sur les tuiles ne dit le déjà-saisi ; recherche persiste en silence |
| 7 | Flexibilité et efficacité | 2 | Aucune quantité rapide ; pas de note par ligne |
| 8 | Esthétique et minimalisme | 3 | Pauvreté tenue ; mais 3 lignes de fiscalité sur un panier qui n'encaisse pas |
| 9 | Récupération d'erreur | 2 | Deux codes traduits, le reste brut ; seul la grille a ErrorState + retry |
| 10 | Aide et documentation | 2 | Bandeau no_network exemplaire ; rien ne dit que l'envoi est définitif |
| **Total** | | **23/40** | **Acceptable** |

## Verdict de spécificité

Reconnaissable, pas interchangeable (triage connexion 3 états, mode 2ᵉ tournée, sessionStorage). Mais structurellement une caisse rétrécie : ouvre sur le catalogue alors que le métier commence par la table ; « aller chercher ce qui est prêt » n'existe que 4 secondes en toast. Scan mécanique : 0 défaut réel (tokens propres).

## Priority Issues

- **[P0] CTA d'envoi actif en no_network** — canSendOrders (useTabletConnectionState.ts:69) consommé nulle part en prod ; bouton gardé par isEmpty||isSending seulement (TabletOrderPage.tsx:314) ; RPC lancé sur réseau mort sans timeout, « Sending… » potentiellement sans fin. Fix : !canSendOrders dans disabled + AbortSignal.timeout. → /impeccable harden
- **[P1] Tuile sans signal « déjà au panier »** — cartQty jamais passé (TabletProductGrid.tsx:185) ; le comptoir le passe (ProductGrid.tsx:54). Fix : abonner la grille au store + qtyByProduct. → /impeccable polish
- **[P1] « Item ready » = toast de 4 s** — useTabletOrderStatusListener.ts:79 ; badge nav compte les commandes en vol sans distinguer « prêt » (TabletLayout.tsx:63). Fix : pastille verte ready dérivée du cache + vibrate sous garde. → /impeccable shape
- **[P1] État par défaut invalide, refus au dernier tap** — tabletCartStore.ts:45 (dine_in + table nulle), refus useCreateTabletOrder.ts:51. Fix minimal : « Table required » ambre + CTA désactivé motivé ; fix juste : ouvrir sur le plan de salle si panier vide sans table. → /impeccable shape
- **[P2] Rail cul-de-sac + recherche scopée** — pas de tuile All (TabletCategorySidebar.tsx:26) ; recherche limitée à la catégorie active (TabletProductGrid.tsx:52). Fix : tuile All + reset query, ou recherche globale. → /impeccable polish

## Persona Red Flags

- Alex : ouverture catalogue entier ; pas de quantité rapide ; − désactivé à qté 1 ; pas de note par ligne.
- Sam : ×/−/+/replier sans anneau de focus (TabletCartPanel.tsx:143-170) ; rail sans focus ; focus: au lieu de focus-visible: sur ProductCard.tsx:96 (anneau qui colle après tap) ; 2-3 h1 simultanés ; légende RESERVED pour un état jamais produit (FloorPlanView.tsx:215) ; tap table inerte = silence.
- Casey : replier le panier en portrait masque le CTA d'envoi (TabletCartPanel.tsx:98) ; état replié non persisté ; pas de pt-safe en haut.

## Minor Observations

min-h-11 inerte (TabletOrderPage.tsx:313) ; minuteur sans tabular-nums (TabletOrderCard.tsx:115) ; setInterval par carte (jusqu'à 50/s) ; pastille+banner redondants ; FLOOR PLAN capitales en dur 24px ; bandeau doré du mode ajout à trancher ; promoActive jamais passé ; 3 lignes fiscalité au pied ; « 26 hours ago » ; role="status" permanent du bandeau d'ajout.

## Questions to Consider

1. Pourquoi ouvrir sur le catalogue et pas sur le plan de salle ?
2. Pourquoi la pauvreté frappe-t-elle la saisie et pas le chrome financier ?
3. Où est la moitié « apporter ce qui est prêt » du métier ?
