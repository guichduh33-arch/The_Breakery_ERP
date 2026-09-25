# @breakery/print-bridge

Service HTTP → ESC/POS (TCP 9100), bus LAN et serveur statique POS de Breakery.
Consommé par le POS et le BO (LAN Devices). Procédure d'exploitation à valider
par Mamat avant commit ; aucun service Windows n'est installé par ce document.

## Endpoints

- `GET /health` : sonde de vie.
- `POST /print/receipt` : reçu caisse (`ReceiptPayload`, promotions incluses).
- `POST /print/ticket` : KOT station ou ticket waiter.
- `POST /drawer/open` : pulse tiroir via l'imprimante caisse.
- `GET /scan/printers?prefix=192.168.1&timeout=500` : scan TCP des plages privées.
- `GET /status/probe?ip=&port=` : sonde d'une imprimante.
- `GET /hub/status` : présence, ring-buffer et état du heartbeat cloud.
- `WS /ws` : bus LAN, hello avec device code/type et token, catchup.
- SPA POS : disponible lorsque `POS_DIST_DIR` désigne un bundle construit.

## Configuration du processus

Le code lit `process.env`, il ne charge pas automatiquement un fichier `.env`.
Copier `.env.example` seul ne configure donc pas le service.
Le lanceur doit injecter les variables ou utiliser explicitement Node
avec `--env-file=<chemin-absolu>` (runtime compatible avec le dépôt).

| Variable | Usage |
|---|---|
| `PORT` | HTTP/WS, défaut 3001 |
| `RECEIPT_PRINTER_IP`, `RECEIPT_PRINTER_PORT` | Reçus sans cible explicite et tiroir ; port par défaut 9100 |
| `POS_DIST_DIR` | Chemin absolu du bundle POS, contenant `index.html` et ses assets |
| `HUB_TOKEN` | Secret boutique, saisi aussi dans POS → Settings → Devices → Hub token |
| `HUB_BUFFER_FILE` | Chemin absolu persistant, hors des répertoires de release |
| `HUB_CLOUD_URL` | URL de `lan-heartbeat-batch` sur la cible confirmée |
| `HUB_CLOUD_SECRET` | Même secret que `LAN_HEARTBEAT_SECRET` côté EF |

Sans `HUB_TOKEN`, le bus accepte les appareils du LAN avec un avertissement au
démarrage. Le heartbeat envoie périodiquement les appareils présents ;
sans sa configuration, il reste désactivé mais le hub local fonctionne.
Le secret cloud est transporté par `x-hub-secret`, jamais dans URL/body.

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
   ce service à Internet. Les endpoints HTTP ne constituent pas une API publique
   authentifiée. Le token du bus WS ne protège pas les commandes d'impression HTTP.
6. Vérifier `http://localhost:3001/health`, le POS sur l'adresse LAN retenue,
   la reconnexion WS, le heartbeat et une impression physique autorisée.
   Adapter le port si nécessaire. Un HTTP 200 ne prouve pas l'impression.

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
