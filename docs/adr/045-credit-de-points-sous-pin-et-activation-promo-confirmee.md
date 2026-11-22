# ADR-045 — Crédit de points sous PIN manager, activation de promotion confirmée

Date : 2026-11-21

Statut : décisions de Mamat du 2026-11-21, prises après l'audit et la critique
du domaine Sales du back-office.

## Contexte

Accorder un avoir client depuis le back-office exige un PIN manager (nonce
`store_credit_grant`, ADR-013). Créditer des points de fidélité n'en exigeait
pas. Or les points se convertissent en avoir : le chemin « créditer des points,
puis les convertir » donnait de l'avoir sans PIN. Deux contrôles différents
gardaient donc la même valeur.

Côté promotions, une case à cocher activait une promotion en un clic. L'effet
est immédiat sur les prix de la caisse, pendant le service.

## Décision

1. **Créditer des points de fidélité depuis le back-office exige un PIN
   manager.** Le manager qui saisit le PIN doit porter la permission
   `loyalty.adjust`. Le serveur vérifie le PIN et consomme une autorisation à
   usage unique ; le client ne décide pas. Le véhicule suit l'arbitrage PIN
   d'`AGENTS.md` : le PIN part en en-tête vers l'Edge Function de vérification,
   jamais dans un corps de requête ni dans une donnée de reprise conservée par
   le navigateur.
2. **Débiter des points ne change pas** : aucun PIN n'est demandé pour retirer
   des points.
3. **Un rejeu idempotent ne consomme aucune autorisation** et rend le résultat
   de la première exécution.
4. **Activer une promotion demande une confirmation** qui dit à partir de quand
   et jusqu'à quand la promotion s'appliquera à la caisse. Désactiver une
   promotion reste direct.

## Conséquences

- La conversion des points en avoir garde son propre contrôle de permission ;
  elle ne demande pas de PIN, car les points convertis ont déjà été accordés
  sous contrôle.
- L'autorisation n'est liée ni au client ni au montant : elle vaut pour un seul
  crédit, pendant sa courte durée de vie. C'est le même modèle que l'autorisation
  d'avoir.
- Toute nouvelle surface qui crédite des points (caisse comprise) doit passer
  par la même autorisation, ou faire l'objet d'un nouvel ADR.

## Bilan factuel

Livré sur la branche `fix/sales-bo-lot2` le 2026-11-21 : famille
`adjust_loyalty_points` (une autorisation de scope `loyalty_points_grant` pour
tout crédit), scope ajouté à l'Edge Function `verify-manager-pin`, champ PIN
dans la fenêtre d'ajustement de points, fenêtre de confirmation d'activation
dans la page Promotions. Migration appliquée sur la base de développement
uniquement à cette date.

Publié en production le 2026-11-21 : PR #761 fusionnée en `f7fd1fe0`,
migration additive, Edge Function `verify-manager-pin` redéployée, back-office
publié sur ce SHA, puis ancienne version de la famille `adjust_loyalty_points`
retirée. Preuves dans
[l'état des environnements](../runbooks/etat-environnements.md#complément-du-21-novembre-2026-20-h-30--lot-2-du-domaine-sales-pin-pour-créditer-des-points-f7fd1fe0).
Aucun crédit de points sous PIN n'avait encore été fait en production à cette
date.
