# Référence produit — The Breakery ERP/POS

> Emplacement préparé le 2026-07-04 (remise à plat).

Ce dossier accueille **LA référence produit** : la description non technique des 25 modules, qui sert de cahier des charges à tout le développement.

## Contenu attendu
- **`DESCRIPTION.md`** (à créer) : la Description **v1.3** = le contenu de `The_Breakery_ERP_Description_v1.2.docx` (2026-07-03) corrigé par la checklist [`../workplan/remise-a-plat/00-AMENDEMENTS-V13.md`](../workplan/remise-a-plat/00-AMENDEMENTS-V13.md) (~70 amendements : surclaims retirés, sous-ventes ajoutées, décision péremption/FIFO intégrée — cf. [ADR-004](../adr/004-pas-de-peremption-ni-fifo-stock.md)).
- Les versions suivantes remplacent le fichier en place (document évergreen), avec un bloc « Historique des versions » en tête et un tag git par version publiée.

## Règles
1. Ce document décrit **ce que fait le produit** pour un lecteur non technique — jamais de noms de RPC, de tables ou de fichiers.
2. Toute revendication « aujourd'hui » doit être vraie dans le code au moment de la publication ; ce qui ne l'est pas va dans « À venir ».
3. Une fonctionnalité abandonnée par décision (ex. péremption/FIFO) est retirée des « À venir » et actée en ADR — elle ne reste pas en promesse.
4. La vérification se fait contre les fiches `workplan/remise-a-plat/NN-*.md` (méthode réel-vs-demandé).
