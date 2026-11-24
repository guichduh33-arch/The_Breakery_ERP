# ADR-047 — Équipements achetés et amortissement automatique

Date : 2026-11-25

Statut : décisions de Mamat du 2026-11-25. Rien n'est encore livré. La section
« Choix de méthode » porte des choix comptables et techniques de l'agent, pris
dans le mandat : ils ne sont pas des décisions de Mamat.

## Contexte

La charte de comptes de la société (2026-11-17) a créé les comptes
d'équipement : `1600` équipement et mobilier, `1610` machines de production,
`1690` amortissements cumulés, `6950` dotation aux amortissements. Le bilan
range déjà les comptes `16xx` en immobilisations.

Aucun parcours n'alimente ces comptes. Une catégorie de dépense ne peut pointer
que vers un compte de charge de classe 6 : la base refuse un compte d'actif. Un
équipement acheté par le circuit des dépenses part donc en charge l'année de
l'achat. Le bilan est sous-évalué et la charge est concentrée sur un seul
exercice.

Seule l'écriture manuelle permet aujourd'hui d'inscrire un équipement et sa
dotation. Rien ne garde la liste des équipements, ni leur plan d'amortissement.

Relevé en production, le 2026-11-25 : une machine de production de
28 791 300 IDR est au `1610` depuis le bilan d'ouverture du 2026-01-01. Elle
est amortie sur 48 mois à partir d'octobre 2025, soit 599 818,75 IDR par mois.
Les amortissements cumulés atteignent 7 197 825 IDR au 2026-09-30 : trois mois
dans le bilan d'ouverture, neuf mois dans les écritures mensuelles importées
des livres bancaires. Octobre et novembre 2026 ne sont pas encore passés.

## Décision

1. **Un achat devient un équipement amorti à partir de 2 000 000 IDR par
   article.** Un lot se juge article par article : trois tablettes à
   1 500 000 IDR restent des dépenses, même si la facture dépasse le seuil. En
   dessous du seuil, l'achat reste une dépense ordinaire, portée au compte de
   sa catégorie.
2. **L'achat d'un équipement se saisit dans le circuit des dépenses.** La
   dépense porte une marque « équipement ». Le circuit de soumission,
   d'approbation et de paiement ne change pas.
3. **À l'approbation, le débit va au compte d'équipement**, au lieu du
   compte de la catégorie, et le même geste crée la fiche de l'équipement.
4. **Chaque équipement a une fiche dans un registre** : nom, compte, groupe
   fiscal, date de mise en service, coût, dépense d'origine, dotations passées,
   valeur nette.
5. **Les durées suivent les groupes fiscaux indonésiens** (UU PPh article 11),
   en linéaire : groupe 1 sur 4 ans (48 mois), pour l'informatique et le petit
   matériel ; groupe 2 sur 8 ans (96 mois), pour les fours, les pétrins et le
   froid professionnel. Le groupe se choisit pour chaque équipement. La
   comptabilité suit l'impôt : aucun écart à suivre. Les autres groupes fiscaux
   ne sont pas ouverts par cette décision.
6. **Le serveur passe la dotation automatiquement, à la fin de chaque mois.**
   Une période fermée ne reçoit pas de dotation : le serveur refuse l'écriture.
7. **La machine déjà inscrite garde son plan.** Elle entre au registre avec
   son coût de 28 791 300 IDR, une mise en service en octobre 2025, le groupe 1
   et ses 7 197 825 IDR d'amortissements cumulés au 2026-09-30. La dotation
   automatique la reprend à octobre 2026. Les comptes déjà passés ne changent
   pas.
8. **La sortie d'un équipement se fait dans le registre** : vente, casse ou
   mise au rebut. L'équipement sort des comptes avec ses amortissements
   cumulés, et le gain ou la perte se calcule seul.
9. **La lecture du registre suit la permission des états financiers**
   (ADR-039, décision 2) : le propriétaire seul à la livraison, qui la délègue
   ensuite depuis l'écran des rôles.

## Choix de méthode

Ces choix de l'agent appliquent les décisions ci-dessus. Ils se révisent par un
nouvel ADR, comme une décision.

- **Montant TTC.** Le seuil et le coût s'entendent toutes taxes comprises : la
  PPN payée au fournisseur fait partie du coût, car The Breakery ne la récupère
  pas (ADR-005).
- **Compte d'équipement.** La dépense marquée « équipement » porte son type :
  équipement et mobilier (`1600`) ou machine de production (`1610`). Le type
  est distinct du groupe fiscal. Le compte crédité reste celui d'une dépense
  ordinaire : fournisseurs si crédit, sinon le compte du paiement.
- **Mois entiers.** Le mois de mise en service compte comme un mois entier ; le
  mois de sortie ne reçoit pas de dotation. Un équipement gardé jusqu'au bout
  reçoit donc exactement le nombre de mois de son groupe. C'est la convention
  déjà suivie par la machine existante (octobre 2025 compté entier).
- **Montant.** La dotation mensuelle est le coût divisé par la durée en mois,
  sans valeur résiduelle. Le dernier mois absorbe l'arrondi : le total des
  dotations égale le coût exactement. La dotation s'arrête quand la valeur
  nette atteint zéro.
- **Écriture de dotation.** Débit `6950`, crédit `1690`, à la date du dernier
  jour du mois. Un équipement ne reçoit jamais deux dotations pour le même
  mois. Un mois manqué se rattrape à sa propre date, au passage suivant, si sa
  période est encore ouverte. Un mois refusé pour période fermée est signalé
  et n'est jamais reporté sur un autre mois.
- **Inscription d'un équipement déjà au bilan.** Le registre permet d'inscrire
  un équipement acheté avant lui, avec ses amortissements cumulés à une date
  donnée, sans écriture d'achat. La dotation automatique part du mois suivant
  cette date : les mois antérieurs ne sont jamais rattrapés.
- **Écriture de sortie.** Le geste exige une date, un motif et, pour une vente,
  le prix et le compte qui reçoit l'argent. L'écriture solde le coût au compte
  d'équipement et les amortissements cumulés au `1690`. Un gain va au `4950`
  produits d'exploitation divers ; une perte va à un compte de charge dédié,
  à créer. La sortie est refusée si sa période est fermée.
- **Contrôle de la sortie.** La sortie exige un PIN manager vérifié par le
  serveur, avec verrouillage, comme les autres gestes qui font disparaître une
  valeur des comptes.
- **Fiche figée.** Une fiche qui a reçu une dotation ne change plus de coût,
  de date de mise en service, ni de groupe. Une erreur se corrige par une
  écriture de correction tracée.
- **Trace.** Chaque geste est tracé dans le journal d'audit : création de la
  fiche, dotation, sortie, correction.

## Conséquences

- Les achats d'équipement à partir de 2 000 000 IDR quittent le compte de
  résultat de l'année d'achat. Le résultat de cette année monte ; les années
  suivantes portent la dotation.
- L'écriture d'une dépense approuvée change pour un équipement : le débit va
  au compte d'équipement. Les autres dépenses ne changent pas.
- Les imports de livres bancaires postérieurs à septembre 2026 ne doivent plus
  porter de ligne de dotation : la machine serait amortie deux fois.
- La charte n'a pas de compte pour les pertes de sortie d'équipement : il est à
  créer avec le module.
- À la livraison, les admins qui approuvent une dépense d'équipement ne voient
  pas le registre, tant que le propriétaire ne leur délègue pas la permission.
- En régime PPh final UMKM, impôt sur le chiffre d'affaires, la dotation ne
  change pas l'impôt. Elle rend le bilan et le résultat justes.
