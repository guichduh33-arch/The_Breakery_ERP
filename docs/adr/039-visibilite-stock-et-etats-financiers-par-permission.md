# ADR-039 — La vue du stock et des états financiers se délègue par permission

Date : 2026-11-17

Statut : décision de Mamat du 2026-11-09 (question `X01`, lot 1 du registre des
décisions rendues de `docs/audit-2026-11/04_QUESTIONS_CLARIFICATION.md`),
précisée par Mamat le 2026-11-17 pour la tâche `S1-08` du master plan de
finition.

## Décision

1. **La vue du stock se pilote par la permission `reports.inventory.read`.**
   Pour le stock théorique, ses mouvements, ses écarts, ses valorisations et le
   stock vitrine, cette permission remplace le test du rôle propriétaire codé
   en dur.

2. **La vue des états financiers se pilote par une permission dédiée,
   `reports.statements.read`.** Elle couvre le bilan, le résultat, le flux de
   trésorerie, la PB1, la marge par produit, le grand livre et la balance. Elle
   est distincte de `reports.financial.read`, qui continue d'ouvrir les rapports
   d'exploitation (balance âgée clients, écarts de caisse, dépenses par
   catégorie, marge POS, paiements fournisseurs, changements de prix, historique
   du coût des recettes).

3. **À la livraison, personne ne gagne de visibilité.** La permission dédiée
   n'est donnée qu'au rôle propriétaire. Le rôle ADMIN garde ses permissions
   actuelles et ne voit toujours ni le stock ni les états financiers. Le
   propriétaire délègue ensuite depuis l'écran des rôles.

## Ce qui ne change pas

- Les **gestes** réservés au propriétaire le restent : finaliser un inventaire,
  approuver ou rejeter une déclaration de stock, rouvrir une période, libérer
  une journée. Cette décision porte sur la vue, pas sur l'action.
- La confidentialité de la **journée en cours** (lot antifraude du
  2026-11-05) : les ventes et l'argent d'un shift non clôturé restent réservés
  au propriétaire. Cette décision ne la touche pas.
- Le comptage à l'aveugle d'un inventaire (ADR-038).

## Contexte

Le lot antifraude du 2026-11-05 a réservé le stock et les états financiers au
seul rôle propriétaire, par un test de rôle. Les permissions `inventory.read`,
`reports.financial.read` et les permissions comptables du rôle ADMIN sont
devenues sans effet sur ces écrans. Le 2026-11-09, Mamat a demandé que cette
visibilité redevienne déléguable par permission.

Le 2026-11-17, deux faits ont précisé la décision. Le rôle ADMIN détient déjà `reports.financial.read` et les permissions
comptables : un simple remplacement du test de rôle par ces permissions lui
aurait ouvert les états financiers (3 comptes ADMIN actifs en production au
relevé du 2026-11-17). Et `reports.financial.read` ouvre aussi à
ADMIN sept rapports d'exploitation qu'il utilise : la lui retirer les lui
aurait fermés. Mamat a choisi une permission dédiée aux états financiers.

## Conséquences

- La permission `reports.statements.read` entre au catalogue, donnée au rôle
  propriétaire seul. L'écran des rôles la montre comme les autres.
- Les fonctions qui exigent le rôle propriétaire pour une **lecture** reçoivent
  une nouvelle version qui exige la permission. Les règles d'accès des tables
  confidentielles suivent la même règle. Le découpage en paquets et la liste des
  fonctions vivent dans le master plan, tâche `S1-08`.
- Conséquence d'implémentation, non tranchée par la décision : les journaux
  (`audit_logs`, `pos_events`, `notification_outbox`) suivent la permission
  existante `reports.audit.read`, et les rapports Z la permission des états
  financiers. Ils étaient réservés au propriétaire par le même test que le
  stock, sans être du stock.
- La permission de visibilité lève le verrou du propriétaire ; elle ne remplace
  pas la permission ordinaire de lecture de chaque table. Un délégué lit le
  stock vitrine s'il détient aussi `display.read`, les mouvements et les lignes
  d'inventaire s'il détient aussi `inventory.read`, les notifications s'il
  détient aussi `settings.read`.
- Le propriétaire voit ces données parce que son rôle détient les permissions,
  et non plus parce qu'il est propriétaire. Retirer l'une d'elles au rôle
  SUPER_ADMIN dans l'écran des rôles lui ferme la vue correspondante, comme
  c'est déjà le cas pour les autres permissions de lecture.
- Une vérification de permission coûte plus qu'un test de rôle. Dans une règle
  d'accès, elle s'évalue une seule fois par requête, jamais ligne par ligne.

## Réversibilité

Revenir au test de rôle demande un nouvel ADR et une nouvelle version des
fonctions. Retirer une délégation ne demande rien de tel : il suffit de retirer
la permission dans l'écran des rôles, et l'effet est immédiat côté serveur.
