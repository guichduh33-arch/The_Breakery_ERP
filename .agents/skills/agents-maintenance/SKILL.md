---
name: agents-maintenance
description: Auditer, corriger, mettre a jour et optimiser AGENTS.md pour le depot Breakery, notamment avant chaque creation de PR. Verifier les faits contre les sources vivantes et soumettre les corrections a Mamat. Ne pas modifier le comportement applicatif.
---

# Entretien des consignes Breakery

Produire des consignes exactes, utiles et faciles a charger. L'optimisation
porte sur la clarte et la maintenance ; elle ne donne pas autorisation de
supprimer un invariant, d'assouplir une obligation ou de changer une decision.

## Cible et autorisation

- Lire `AGENTS.md` a la racine et les instructions locales applicables avant
  toute intervention. Si la demande dit `agent.md`, verifier le fichier reel ;
  ne pas creer un second fichier par supposition.
- Distinguer une demande d'audit d'une demande de modification. Un audit rend
  ses constats en conversation. Une demande de modification autorise la
  redaction d'un diff dans le perimetre demande.
- Appliquer les validations imposees par `AGENTS.md` : proposer a Mamat toute
  suppression, relocalisation, modification de regle ou decision nouvelle avant
  l'action. Une contradiction entre document et code se signale ; elle ne se
  corrige pas automatiquement.
- Ne pas committer de documentation sans validation explicite du contenu par
  Mamat. Respecter les regles de branche et de push du depot.

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
en nouveau chantier sans validation.

L'analyse et la preparation des propositions peuvent avancer de facon autonome
en lecture seule. Toute amelioration ou alternative proposee a l'initiative de
l'agent attend la validation explicite de Mamat avant execution, y compris les
editions, deplacements, suppressions et changements de regles. Une absence de
reponse ne vaut pas accord. Apres validation, executer le perimetre approuve ;
si une nouvelle decision apparait, la soumettre a Mamat avant de l'appliquer.

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
   dans les zones vivantes necessaires (`docs/adr`, `docs/objectifs`,
   `docs/product`, `docs/runbooks`, code, scripts, workflows et sources agents).
   Ne jamais explorer la quarantaine ou son tag.
5. Si la preuve exige la DB live, suivre les skills Supabase et metier pertinents
   pour une verification en lecture seule. Aucun test avec mutations, migration
   ou deploiement n'est autorise par ce skill. Si une preuve manque, indiquer
   l'incertitude et demander l'information necessaire.

## Propositions et redaction

Presenter les constats avec le passage concerne, la preuve `fichier:ligne`
en conversation, l'effet concret et la correction proposee. Distinguer :

- Fait perime ou contradiction : signaler l'ecart et faire valider la correction.
- Intention non implementee : conserver l'intention et signaler le backlog.
- Ambiguite ou conflit de regles : demander l'arbitrage de Mamat.
- Repetition ou longueur : proposer une formulation plus courte en preservant
  portee, exceptions, interdictions et conditions de validation.

Apres autorisation, appliquer uniquement les passages convenus. Ecrire en
francais, avec des ancres stables dans les documents. Preferer les familles de
RPC aux versions vivantes, sans effacer une version imposee par un ADR ou un
fait historique date. Eviter compteurs vivants et references a des plans de
session. Verifier aussi les lignes que la modification rendrait fausses.

Les regles racines vivent dans `AGENTS.md`, les procedures specialisees dans
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
2. Relire `AGENTS.md` et verifier les affirmations concernees par le diff :
   chemins, commandes, contrats, invariants et decisions applicables. Lire les
   implementations, les appelants et la documentation vivante utiles ; ne pas
   pretendre avoir audite tout le depot ou l'etat DB live depuis un diff local.
3. Presenter les constats et propositions en conversation avant l'ouverture,
   meme si le constat est qu'aucune mise a jour des consignes n'est necessaire.
   Pour une correction, donner le passage vise, la preuve et le changement
   propose. Attendre la validation explicite de Mamat avant son execution.
   Un arbitrage bloquant exige une decision ou un report explicitement valide
   avant l'ouverture ; une suggestion facultative ne devient pas un chantier
   par sa seule presence dans l'audit.
4. Apres correction autorisee, suivre les controles de livraison ci-dessous.
   L'autorisation de modifier ou d'ouvrir une PR ne vaut pas validation du
   contenu documentaire a committer. Revalider les conclusions affectees par
   toute modification du diff apres l'audit.
5. Avant l'appel de creation de PR, restituer le resultat de l'audit et verifier
   que les arbitrages bloquants sont clos. Inclure dans la description de PR
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
