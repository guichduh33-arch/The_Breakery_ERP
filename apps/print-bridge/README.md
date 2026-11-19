# @breakery/print-bridge

Service HTTPS → ESC/POS (TCP 9100), bus LAN WSS et serveur statique POS de Breakery.
Consommé par le POS et les tablettes. Les autorisations d'appareils se gèrent
dans le back-office (LAN Devices) et arrivent au hub par la synchronisation
cloud (ADR-034). Aucun service Windows n'est installé par ce document.
Mise en service d'un poste neuf :
[runbook du hub réseau](../../docs/runbooks/hub-reseau-mise-en-service.md).

## Endpoints

Les routes protégées exigent l'identité d'un appareil appairé : en-têtes
`x-lan-device-code` et `x-lan-secret`, puis la capacité indiquée. Sans identité :
`401 device_unauthorized` ; sans la capacité : `403 device_forbidden`.

- `GET /health` : sonde de vie, publique, renvoie `release_sha`.
- `POST /print/receipt` : reçu caisse (`receipts.print`).
- `POST /print/ticket` : KOT station ou ticket serveur (`tickets.print`).
- `POST /drawer/open` : pulse tiroir via l'imprimante caisse (`drawer.open`).
- `GET /scan/printers?prefix=192.168.1&timeout=500` : scan TCP (`diagnostics`).
- `GET /status/probe?ip=&port=` : sonde d'une imprimante (`diagnostics`).
- `GET /hub/status` : présence, ring-buffer et heartbeat cloud (`diagnostics`).
- `WSS /ws` : bus LAN ; le hello porte le code de l'appareil et son secret.
- SPA POS : disponible lorsque `POS_DIST_DIR` désigne un bundle construit.

Une impression vers une imprimante absente du registre est refusée
(`403 printer_forbidden`).

## Configuration du processus

Le code lit `process.env`, il ne charge pas automatiquement un fichier `.env`.
Copier `.env.example` seul ne configure donc pas le service.
Le lanceur doit injecter les variables ou utiliser explicitement Node
avec `--env-file=<chemin-absolu>` (runtime compatible avec le dépôt).

| Variable | Obligatoire | Usage |
|---|---|---|
| `HUB_TLS_CERT` | **oui** | Chemin du certificat TLS (PEM) du nom servi aux terminaux |
| `HUB_TLS_KEY` | **oui** | Chemin de la clé privée (PEM) de ce certificat |
| `HUB_ALLOWED_ORIGINS` | **oui** | Origines web admises, séparées par des virgules (`https://hôte:port`) ; au moins une |
| `HUB_REGISTRY_FILE` | conseillé | Chemin absolu persistant du registre des appareils ; défaut `hub-registry.json` dans le répertoire courant |
| `PORT` | non | HTTPS/WSS, défaut 3001 |
| `RECEIPT_PRINTER_IP`, `RECEIPT_PRINTER_PORT` | non | Reçus sans cible explicite et tiroir ; port par défaut 9100 |
| `POS_DIST_DIR` | non | Chemin absolu du bundle POS, contenant `index.html` et ses assets |
| `HUB_BUFFER_FILE` | conseillé | Chemin absolu persistant du ring-buffer, hors des répertoires de release ; défaut `hub-buffer.jsonl` |
| `HUB_CLOUD_URL` | en pratique | URL HTTPS de `lan-heartbeat-batch` sur la cible confirmée |
| `HUB_CLOUD_SECRET` | en pratique | Même secret que `LAN_HEARTBEAT_SECRET` côté EF |

**Sans certificat, clé et au moins une origine, le processus refuse de démarrer**
(`HTTPS certificate, key and allowed origins are required`). Une `HUB_CLOUD_URL`
qui n'est pas en `https://` l'arrête aussi. Il n'existe plus de mode HTTP en
clair ni de jeton boutique partagé : chaque appareil s'authentifie seul.

Sans `HUB_CLOUD_URL` et `HUB_CLOUD_SECRET`, le hub démarre mais ne reçoit jamais
le registre des appareils : aucun appareil ne peut s'y authentifier tant
qu'aucun registre valide n'a été reçu une première fois. Ensuite, le dernier
registre reçu est gardé dans `HUB_REGISTRY_FILE` et sert pendant une coupure
Internet. Le secret cloud est transporté par `x-hub-secret`, jamais dans URL/body.

Les deux défauts relatifs (`hub-registry.json`, `hub-buffer.jsonl`) dépendent du
répertoire de travail : un lanceur qui en change perd le registre et le buffer.
Toujours poser des chemins absolus.

Protéger le fichier de configuration par les droits Windows, hors du dépôt et
des bundles. Le compte du service doit pouvoir lire le bundle et écrire le buffer.
Le buffer LAN n'est **pas** une sauvegarde de l'outbox de ventes des navigateurs.

## Préparer et lancer

1. Depuis un checkout du SHA validé, construire le POS avec sa configuration
   Supabase de production confirmée, puis le bridge :
   `pnpm --filter @breakery/app-pos build` et
   `pnpm --filter @breakery/print-bridge build`.
2. Préparer une livraison versionnée du POS, du bridge et de ses dépendances
   runtime. Vérifier sur une machine de répétition ; copier seulement
   `dist/server.js` n'est pas une preuve que toutes les dépendances sont livrées.
3. Configurer le lanceur existant pour exécuter Node avec un chemin absolu vers
   `apps/print-bridge/dist/server.js`, les variables ci-dessus et un répertoire
   de travail explicite. Exemple de forme, chemins à confirmer :
   `node --env-file=C:/Breakery/config/bridge.env C:/Breakery/releases/<sha>/apps/print-bridge/dist/server.js`.
4. Faire valider le mécanisme de démarrage automatique et de redémarrage déjà
   utilisé sur le PC, le compte, les journaux et leur rotation.
   Ne pas installer NSSM/PM2 ou un autre gestionnaire implicitement.
5. Restreindre l'accès réseau au LAN boutique et au port prévu ; ne pas exposer
   ce service à Internet. L'identité d'appareil protège l'impression, le tiroir
   et les diagnostics, pas `/health` ni la SPA.
6. Vérifier `https://<nom du certificat>:<port>/health`, le POS sur l'origine
   retenue, la reconnexion WSS, le heartbeat et une impression physique
   autorisée. Un HTTP 200 ne prouve pas l'impression.

Blocage local d'urgence, sur le PC, en administrateur local :
`node --env-file=<configuration> <release>/apps/print-bridge/dist/security/block-device.js block <UUID de l'appareil>`
(`unblock` pour lever). Le blocage s'écrit à côté du registre
(`<HUB_REGISTRY_FILE>.blocked`) et survit aux synchronisations et au redémarrage.

Conserver une origine LAN stable (protocole, hôte et port) : en changer peut rendre
inaccessible le stockage navigateur contenant des ventes en attente.
Le BO HTTPS publié sur Vercel ne doit pas être supposé capable d'appeler
directement ce service HTTP LAN ; vérifier le parcours réellement utilisé.

## Mise à jour et retour local

Après construction dans un checkout propre du SHA retenu, la commande
`node scripts/release/manifest.mjs print-bridge` inventorie `apps/print-bridge/dist` ;
`node scripts/release/manifest.mjs pos` inventorie le bundle POS. Les variables
`RELEASE_SHA` et `SUPABASE_PROJECT_REF_PRODUCTION` doivent être explicites.
Conserver les manifestes avec la livraison et vérifier leur contenu avec
`--verify` avant transfert. Ils ne prouvent pas qu'un poste a été mis à jour.
Le manifeste du `dist` bridge **n'inclut pas les dépendances npm externes** :
préparer et identifier séparément ces dépendances, le runtime Node et la
configuration protégée avant de considérer la livraison boutique complète.

- Avant mise à jour, identifier la version active, préserver le bundle précédent,
  la configuration et le buffer, puis relever les files de chaque terminal.
  Ne jamais effacer le stockage navigateur pour « repartir propre ».
- Préparer les nouveaux fichiers dans un répertoire versionné distinct. Valider
  compatibilité POS/bridge/EF/DB et lecture des anciens intents offline.
- Dans une fenêtre approuvée, arrêter proprement le service existant, modifier
  les chemins de lancement et `POS_DIST_DIR`, conserver le même buffer persistant,
  puis redémarrer avec le même compte et la même origine LAN.
- Contrôler santé, chargement des assets, reconnexion des terminaux, ticket,
  reprise des files et absence de doublon. Répéter aussi après redémarrage du PC.
- Si retour nécessaire et compatibilité démontrée : arrêter, restaurer les chemins
  du bridge et du POS précédents ainsi que la configuration compatible, conserver
  les données persistantes, redémarrer et refaire les contrôles.
  Ne pas remplacer le buffer par une copie ancienne sans procédure validée.

Le tiroir utilise le pulse standard de l'imprimante caisse (RJ11) ; sa cible
est la même que celle des reçus sans imprimante explicite.
Voir [la bascule V3](../../docs/runbooks/production-v3-cutover.md)
pour la sauvegarde/restauration DB et le rapprochement des ventes.
