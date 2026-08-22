# ADR-029 — Empaquetage des tablettes de salle : Capacitor autour du bundle web existant

> **Date :** 2026-08-22 · **Statut : ACTÉ** (décision propriétaire 2026-08-22, en réponse au
> lot F de l'audit POS waiter du même jour ; commit du texte après validation)

## Décision

La tablette de salle devient une **application installable**, obtenue en emballant le
**bundle web existant** dans une coquille native **Capacitor**. Android d'abord, iOS ouvert
depuis le même code.

Il n'y a **pas** de réécriture : `/tablet` reste la même route React servie par le même
build Vite. Capacitor ajoute une enveloppe, il ne remplace rien.

Les deux alternatives sont écartées : la **PWA**, qui ne lève pas l'empêchement décisif
ci-dessous, et la **réécriture native** (React Native ou natif), qui jetterait un module
déjà éprouvé.

## Contexte

- Le mandat d'audit parlait d'« application Android » et de « config Capacitor ». Ni l'une ni
  l'autre n'existaient : vérifié le 2026-08-22, aucune dépendance `@capacitor/*` ni `tauri`
  dans le dépôt, aucun dossier `android/`, `ios/` ou `src-tauri/`, aucun
  `capacitor.config.*`. La tablette ouvrait `/tablet` dans le navigateur de l'appareil.
- **L'empêchement décisif est le bus LAN.** `hubWsUrl` dérive l'adresse du hub du
  `printerUrl` en remplaçant `http` par `ws` : la liaison est un WebSocket **en clair**, vers
  une IP locale. Un navigateur refuse d'ouvrir un `ws://` depuis une page servie en `https://`
  — c'est la règle du contenu mixte, et elle ne se contourne pas côté page. Une tablette web
  ne peut donc pas avoir à la fois HTTPS et le bus LAN. C'est ce bus qui nourrit la cuisine
  quand internet tombe.
- Trois empêchements secondaires, tous propres au navigateur :
  - un onglet mis en arrière-plan, ou un écran qui s'endort, suspend minuteurs et
    WebSockets — or une tablette de salle passe sa journée à s'endormir ;
  - la file hors-ligne vit en IndexedDB, que le navigateur peut évincer sous pression de
    stockage. Cette file contient des commandes réelles ;
  - rien n'empêche le personnel de quitter l'application.
- La PWA ne traite **aucun** de ces quatre points : c'est toujours un navigateur, soumis à la
  même règle de contenu mixte. Sur iOS elle est en outre privée d'arrière-plan et son
  stockage s'efface après une période d'inactivité.

## Arbitrages (propriétaire, 2026-08-22)

1. **Capacitor**, pas PWA, pas réécriture.
2. **Le bundle web reste la source unique.** Aucune branche de code spécifique au natif dans
   les composants ; les capacités natives passent par des adaptateurs isolés.
3. **Android d'abord.** iOS reste ouvert par la même base de code, sans engagement de date.
4. **Ce chantier suit le lot E de l'audit**, jamais l'inverse : on n'emballe pas un module
   dont le parcours bout en bout n'est pas tenu par un filet.

## Conséquences

1. Le trafic en clair vers le réseau local devra être **autorisé explicitement et
   étroitement** côté Android — pour l'hôte du hub, pas globalement. C'est le geste qui
   justifie tout le chantier ; le faire trop large annulerait le bénéfice de sécurité qu'on
   vient chercher en passant à HTTPS.
2. Le dépôt gagne une chaîne de fabrication native — SDK Android, signature, artefact
   installable — qui n'existe pas aujourd'hui. La CI actuelle ne la couvre pas.
3. `apps/pos` cesse d'être un pur projet web. La règle « le code vit dans `apps/*/src` »
   s'assouplit pour les dossiers natifs générés.
4. Le lot F pèse, selon l'audit, autant que les lots A à E réunis. Il est traité comme un
   chantier neuf, pas comme la fin de la clôture d'audit.

## Ce que cette décision ne tranche pas

Ces points restent à arbitrer avant la première fabrication, et ne sont pas présumés ici :

- l'identifiant d'application et le nom affiché ;
- la version d'Android visée, et le modèle exact des tablettes en service — rien dans le
  dépôt ne les documente, l'audit l'a relevé comme information manquante ;
- le mode d'installation : magasin, distribution interne, ou installation manuelle ;
- le **mode kiosque** — souhaitable d'après l'audit, mais jamais demandé explicitement ;
- la stratégie de mise à jour du contenu web à l'intérieur de la coquille ;
- si la caisse et le KDS suivent le même chemin, ou restent web.
