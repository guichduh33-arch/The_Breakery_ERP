---
name: agents-maintenance
description: Auditer, corriger et optimiser les consignes Breakery, notamment avant chaque PR. Verifier les faits contre les sources vivantes et valider les corrections dans l'objectif demande. Ne pas modifier le comportement applicatif.
---

# Entretien des consignes Breakery

Produire des consignes exactes, utiles et faciles a charger. L'optimisation
porte sur la clarte et la maintenance ; elle ne donne pas autorisation de
supprimer un invariant, d'assouplir une obligation ou de changer une decision.

## Cible et autorisation

- Lire `CLAUDE.md` a la racine et les instructions locales applicables avant
  toute intervention. Si la demande dit `agent.md`, verifier le fichier reel ;
  ne pas creer un second fichier par supposition.
- Distinguer une demande d'audit d'une demande de modification. Un audit rend
  ses constats en conversation. Une demande de modification autorise la
  redaction d'un diff dans le perimetre demande.
- Appliquer le mandat et l'autonomie d'`CLAUDE.md` : Mamat definit l'objectif,
  l'agent choisit, verifie et valide la procedure necessaire de bout en bout.
  Signaler une contradiction factuelle puis la corriger dans le perimetre ;
  ne jamais remplacer une decision metier par le comportement actuel du code.
- Relire et committer la documentation necessaire, puis pousser et ouvrir la PR
  selon les controles du depot, sans validation intermediaire de Mamat.

## Initiative et alternatives

L'agent est encourage a exercer son jugement et a proposer spontanement des
ameliorations, meme si Mamat ne les a pas demandees individuellement : clarifier
une regle, reduire une repetition, reorganiser les consignes, mieux repartir
les informations entre regles racines et skills, ou presenter une autre approche.
Il peut aussi remettre en question une consigne existante avec des arguments
et proposer son evolution ; la proposition ne modifie pas la regle en vigueur.

Pour chaque proposition, expliquer le probleme observe, le benefice attendu,
les risques et les fichiers concernes. Presenter les alternatives utiles et
recommander une option avec ses raisons. Distinguer clairement les corrections
demandees des suggestions supplementaires ; ne pas transformer une suggestion
en nouveau chantier sans demande correspondante.

Dans l'objectif demande, choisir l'option utile, executer les corrections et
les valider avec les preuves adequates. Les ameliorations hors objectif restent
des propositions. Demander seulement une information indispensable absente,
un choix hors mandat ou la resolution d'un blocage externe ; ne pas demander
une nouvelle approbation pour une etape technique ou un commit documentaire.

## Releve cible

1. Verifier la branche, `git status` et le diff existant. Preserver le travail
   present. Lire les fichiers avant de les modifier.
2. Relever les affirmations du passage vise : faits verifiables, decisions,
   intentions, commandes, liens et incidents historiques. Conserver ce releve
   en conversation, jamais dans un plan en fichier.
3. Verifier chaque fait avec une source adaptee : manifests pour les packages
   et outils, scripts et workflows pour les commandes, implementations et
   appelants pour les contrats. Les migrations prouvent une histoire locale,
   pas a elles seules l'etat live ou un deploiement.
4. Lire le corps des ADR cites lorsqu'une decision concerne le passage. Chercher
   dans les zones vivantes necessaires (`docs/adr`,
   `docs/SPECS_OFFICIELS_ERP_POS.md`, `docs/audit`, `docs/runbooks`, code,
   scripts, workflows et sources agents). Ne jamais explorer la quarantaine ni
   son tag, ni `docs/_archive_obsolete` (archivee le 2026-11-09).
5. Si la preuve exige la DB live, suivre les skills Supabase et metier pertinents
   pour une verification en lecture seule. Aucun test avec mutations, migration
   ou deploiement n'est autorise par ce skill. Si une preuve manque, indiquer
   l'incertitude et demander l'information necessaire.

## Propositions et redaction

Presenter les constats avec le passage concerne, la preuve `fichier:ligne`
en conversation, l'effet concret et la correction proposee. Distinguer :

- Fait perime ou contradiction : signaler l'ecart, corriger puis verifier.
- Intention non implementee : conserver l'intention et signaler le backlog.
- Ambiguite : resoudre les choix de methode dans le mandat ; demander une
  decision metier indispensable absente ou un arbitrage hors objectif.
- Repetition ou longueur : proposer une formulation plus courte en preservant
  portee, exceptions, interdictions et conditions de validation.

Appliquer uniquement les passages necessaires a l'objectif. Ecrire en
francais, avec des ancres stables dans les documents. Preferer les familles de
RPC aux versions vivantes, sans effacer une version imposee par un ADR ou un
fait historique date. Eviter compteurs vivants et references a des plans de
session. Verifier aussi les lignes que la modification rendrait fausses.

Les regles racines vivent dans `CLAUDE.md`, les procedures specialisees dans
`.agents/skills` et les profils sources dans `.claude/agents`. Toute proposition
de deplacement doit preciser comment les consignes resteront decouvrables et
quand elles seront chargees. Ne pas editer les miroirs manuellement.

## Declenchement avant une PR

Appliquer ce parcours avant toute creation de PR par un agent, y compris une
draft, quel que soit l'outil d'ouverture. Il s'agit d'une etape obligatoire du
travail de l'agent ; une verification CI apres ouverture ne la remplace pas.

1. Identifier la branche cible reelle et verifier `git status`, les commits du
   sujet et le diff depuis leur ancetre commun. Distinguer le contenu prevu
   pour la PR des modifications locales et fichiers non suivis ; ne pas les
   ajouter, committer ou publier implicitement. Si la cible manque et ne peut
   pas etre etablie, la demander avant l'ouverture.
2. Relire `CLAUDE.md` et verifier les affirmations concernees par le diff :
   chemins, commandes, contrats, invariants et decisions applicables. Lire les
   implementations, les appelants et la documentation vivante utiles ; ne pas
   pretendre avoir audite tout le depot ou l'etat DB live depuis un diff local.
3. Presenter les constats et propositions en conversation avant l'ouverture,
   meme si le constat est qu'aucune mise a jour des consignes n'est necessaire.
   Pour une correction, donner le passage vise, la preuve et le changement
   effectue et sa verification. Corriger les ecarts dans le mandat sans attente
   de validation intermediaire ; resoudre toute information indispensable manquante
   avant l'action dependante. Une suggestion facultative ne devient pas un chantier
   par sa seule presence dans l'audit.
4. Apres correction, suivre les controles de livraison ci-dessous.
   L'agent valide le contenu documentaire necessaire au resultat demande.
   Revalider les conclusions affectees par
   toute modification du diff apres l'audit.
5. Avant l'appel de creation de PR, restituer le resultat de l'audit et verifier
   que les constats bloquants sont resolus. Inclure dans la description de PR
   une preuve concise : perimetre, corrections validees ou absence de correction,
   controles executes et limites. Ne pas annoncer un audit non execute.

## Verification et livraison

- Lire `scripts/agents/sync.mjs` avant de regenerer les miroirs ; verifier le
  perimetre prevu et les divergences existantes. Une regeneration qui toucherait
  des sources hors mandat doit etre signalee avant l'ecriture.
- Pour les sources autorisees, regenerer avec
  `node scripts/agents/sync.mjs --write`, puis controler avec
  `node scripts/agents/sync.mjs --check`.
- Verifier le diff complet, les liens touches, la limite de taille et
  `git diff --check`. Executer les gardes documentaires applicables identifiees
  dans les workflows et scripts, sans pretendre qu'un controle de format
  valide les faits ou la pertinence des instructions.
- Pour un skill cree ou modifie, utiliser le validateur de `skill-creator`
  lorsqu'il est disponible. Aucun test applicatif ou live n'est requis par
  une simple modification documentaire.
- Restituer les fichiers modifies, les decisions validees, les controles
  executes, les limites et les points restant a arbitrer. Ne pas annoncer
  de commit, de validation de Mamat ou de memorisation sans preuve.
