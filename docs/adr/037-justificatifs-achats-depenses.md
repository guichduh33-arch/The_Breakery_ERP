# ADR-037 — Justificatifs des achats et des dépenses

Date : 2026-11-03

Statut : accepté par Mamat le 2026-11-03.

## Décision

Dans le back-office, chaque bon de commande fournisseur et chaque dépense doit
être accompagné d'une facture justificative au format JPEG ou PDF avant son
paiement. La réception d'un achat comptant constitue aussi un paiement et suit
cette règle. Un achat à crédit peut être réceptionné avant le dépôt de sa facture.

Pour une dépense réglée par Petty Cash, le justificatif est obligatoire avant
sa validation : chaque étape d'approbation et l'approbation automatique sont
concernées. Les règles de séparation des tâches et d'approbation restent
applicables. Pour les autres dépenses, le justificatif peut être ajouté jusqu'au
paiement.

Les transactions dont l'import a été effectué strictement avant le
31 octobre 2026 à 00 h 00 dans le fuseau métier `Asia/Makassar` sont exemptées.
Le critère est la date réelle de l'import, prouvée par les registres serveur,
et non la date historique de la transaction. Une transaction saisie manuellement
et antidatée ne bénéficie pas de cette exception. Les imports ultérieurs ne
peuvent contourner le contrôle en créant directement une transaction payée.

## Conservation et contrôle

Les pièces sont conservées dans un stockage privé. Leur dépôt et leur
téléchargement suivent les droits de l'utilisateur et sa session active.
Le contrôle serveur confirme l'existence et le format de la pièce avant
l'action financière ; le contrôle de l'interface ne suffit pas.

Une dépense déjà soumise ou approuvée peut recevoir une facture manquante ou
invalide sans réécrire sa chaîne d'approbation. La pièce valide soumise reste
verrouillée. Pour les achats, la pièce valide reste verrouillée après le premier
paiement ; une pièce manquante peut être ajoutée avant un paiement suivant.
Les nouvelles pièces acceptées sont des JPEG ou PDF de 5 Mo au maximum.
Les anciennes tentatives de dépôt interrompues restent récupérables.
