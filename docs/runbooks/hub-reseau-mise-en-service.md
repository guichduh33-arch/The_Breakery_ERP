# Runbook — mettre en service le hub réseau sur un PC boutique

> Périmètre : la **première** mise en service du pont d'impression et du hub
> LAN (`apps/print-bridge`) sur un PC neuf, jusqu'au premier appareil appairé.
> La mise à jour d'un poste déjà en service suit
> [l'installation d'une release](shop-install.md). Décision de référence :
> [ADR-034](../adr/034-autorisation-appareils-lan.md), qui exige ce runbook.
> Rédigé le 2026-11-20 depuis le code de `master` ; **aucun poste neuf n'a encore
> suivi ce texte**. La première mise en service qui le suit en est la preuve.

## Ce que le hub fait, et ce qu'il refuse

Un seul processus Node sert, sur le même port :

- la caisse (SPA POS) quand `POS_DIST_DIR` est posé ;
- l'impression des reçus, des tickets et l'ouverture du tiroir ;
- le bus temps réel `wss://…/ws` entre caisse, tablettes et écran cuisine.

Il ne démarre **qu'en HTTPS**, avec un certificat, sa clé et au moins une origine
admise. Il n'existe ni mode HTTP en clair, ni jeton boutique partagé : chaque
appareil a sa propre identité, émise depuis le back-office. Une configuration
incomplète refuse les opérations protégées ; elle ne rouvre jamais un accès
anonyme.

## 1. Prérequis à réunir avant de toucher le PC

| Élément | Où le trouver | Contrôle |
|---|---|---|
| Cible Supabase | [état des environnements](etat-environnements.md) : production V3 `yjhhhmjgsmyzyymvixot` | La référence lue dans le bundle POS à installer est la même |
| Nom servi aux terminaux | Le nom DNS du certificat (relevé en production : `pos.the-breakery.com`) | Le nom résout vers l'adresse LAN du PC sur chaque terminal |
| Certificat et clé PEM | Hors Git, jamais dans une release | Le certificat couvre le nom ci-dessus et n'est pas expiré |
| Secret du heartbeat | Le secret `LAN_HEARTBEAT_SECRET` de l'Edge Function `lan-heartbeat-batch` de la cible | Il existe côté cloud ; il ne transite ni par Git ni par un chat |
| Node 22 | Le runtime ciblé par la construction du pont | `node --version` sur le PC |
| Paquet de release | L'artefact du workflow `package-shop-release.yml` (voir [shop-install](shop-install.md)) | Empreinte de l'archive égale à son `.sha256` |
| Compte de service Windows | Un compte local dédié, sans droits d'administration | Il peut lire la release et écrire le registre et le buffer |

Un certificat que les navigateurs des terminaux n'acceptent pas bloque tout :
la caisse ne charge pas, les tablettes ne joignent pas le bus. Un certificat
public pour le nom servi évite d'installer une autorité sur chaque terminal.
Son renouvellement est une tâche à part, à relever comme telle : le pont ne
relit les fichiers TLS qu'au démarrage.

## 2. Disposer les fichiers

Créer, hors de tout répertoire de release, des emplacements stables :

| Contenu | Variable | Exemple de forme |
|---|---|---|
| Release extraite | — | `C:\BreakeryV3\releases\<sha>` |
| Configuration externe | — | `C:\BreakeryV3\config\bridge.env` |
| Certificat, clé | `HUB_TLS_CERT`, `HUB_TLS_KEY` | `C:\BreakeryV3\security\…` |
| Registre des appareils | `HUB_REGISTRY_FILE` | `C:\BreakeryV3\data\hub-registry.json` |
| Ring-buffer du bus | `HUB_BUFFER_FILE` | `C:\BreakeryV3\data\hub-buffer.jsonl` |

Droits Windows : le compte de service lit la release, la configuration et le
dossier de sécurité ; il écrit le dossier de données. Les autres comptes
standards n'ont aucun accès à la configuration ni à la clé. Le registre et son
fichier de blocage (`<registre>.blocked`) restent protégés de la même façon.

Le registre et le buffer **doivent** être des chemins absolus. Leurs défauts sont
relatifs au répertoire de travail : un lanceur qui change de répertoire repart
alors sans registre, donc sans aucun appareil autorisé.

## 3. Écrire la configuration

Le pont lit `process.env` et ne charge aucun `.env` seul. La liste complète des
variables, obligatoires et facultatives, est dans le
[README du pont](../../apps/print-bridge/README.md#configuration-du-processus).
Les trois sans lesquelles le pont refuse de démarrer :

- `HUB_TLS_CERT` et `HUB_TLS_KEY` ;
- `HUB_ALLOWED_ORIGINS`, au moins une origine.

À poser aussi, même si le pont démarre sans : `HUB_REGISTRY_FILE` et
`HUB_BUFFER_FILE` en chemins absolus (section 2), et `RECEIPT_PRINTER_IP`
(avec `RECEIPT_PRINTER_PORT` si ce n'est pas 9100) pour les reçus sans
imprimante explicite et pour le tiroir. Cette imprimante de reçus doit aussi
être déclarée dans le back-office avec la même adresse et le même port
(section 6) : sinon le pont refuse le tiroir et ces reçus
(`403 printer_forbidden`).

`HUB_ALLOWED_ORIGINS` liste les pages servies **ailleurs** qui appellent le pont,
sous la forme exacte `https://hôte:port`, séparées par des virgules. Une page
servie par le pont lui-même appelle sa propre origine, que le pont admet
d'office.

Pour la synchronisation des autorisations, poser `HUB_CLOUD_URL` à l'URL HTTPS
de `lan-heartbeat-batch` sur la cible vérifiée, et `HUB_CLOUD_SECRET` au secret
du heartbeat. Sans elles, le hub démarre mais ne reçoit jamais de registre :
aucun appareil ne peut s'y authentifier. Le registre reçu est lié à cette URL ;
changer d'URL invalide le registre gardé en cache jusqu'à la synchronisation
suivante.

## 4. Lancer et rendre le démarrage durable

Forme minimale, chemins à adapter :

```powershell
node --env-file=C:\BreakeryV3\config\bridge.env C:\BreakeryV3\releases\<sha>\apps\print-bridge\dist\server.js
```

Le poste en service utilise un lanceur JavaScript (`start.cjs`) qui lit la
configuration externe, pose `POS_DIST_DIR` et importe le `server.js` de la
release, sous une tâche planifiée du compte de service (relevé du 2026-11-10,
voir [shop-install](shop-install.md)). Un poste neuf reprend cette disposition :
c'est celle que l'installateur des mises à jour sait contrôler. Ne pas installer
NSSM, PM2 ni un autre gestionnaire par défaut.

Au démarrage, la console écrit une ligne `[print-bridge] listening on :<port>`
qui dit si l'imprimante de reçus, la synchronisation cloud et la SPA sont
configurées. Un arrêt immédiat avec `HTTPS certificate, key and allowed origins
are required` signale la section 3 incomplète.

Pare-feu : ouvrir le port du pont au seul réseau boutique. Le pont n'est pas
une API publique ; il ne doit pas être joignable depuis Internet.

## 5. Contrôler le pont seul

Depuis le PC puis depuis un terminal du LAN :

1. `https://<nom>:<port>/health` répond `status: ok` et le `release_sha` livré.
   Un avertissement de certificat dans le navigateur est un échec, pas un détail.
2. La caisse s'ouvre sur `https://<nom>:<port>/` quand `POS_DIST_DIR` est posé.
3. Une route protégée sans identité répond `401 device_unauthorized`
   (par exemple `/hub/status`). C'est le comportement attendu.

## 6. Appairer le premier appareil

1. **Back-office → LAN devices** (permission `lan.devices.read` pour voir,
   `lan.devices.manage` pour agir) : déclarer l'appareil s'il n'existe pas, puis
   **Create activation code**. Le code est à usage unique et expire vite ;
   l'heure d'expiration s'affiche. Seuls une caisse, une tablette ou un écran
   cuisine s'appairent ainsi.
2. Sur le terminal, **Settings → Devices** : saisir le code. L'activation exige
   Internet. Le terminal tire son propre secret, l'envoie au cloud et le garde ;
   le code ne sert plus.
3. Back-office : l'appareil passe à **Paired**. Il a reçu les capacités par
   défaut de son type (une caisse imprime et ouvre le tiroir, une tablette
   envoie des commandes et imprime des tickets, un écran cuisine lit et met à
   jour la cuisine). **Permissions** sert à les ajuster : retirer ce qui n'a
   pas lieu d'être, par exemple le tiroir (`Open cash drawer`) hors de la
   caisse.
4. Déclarer l'imprimante de reçus et chaque imprimante de cuisine comme
   appareils de type imprimante, actifs, avec leur adresse et leur port.
5. Attendre la synchronisation suivante du hub (de l'ordre de dix secondes) :
   le registre arrive alors sur le PC. Ensuite seulement, le terminal joint le
   bus et imprime.

Les imprimantes autorisées viennent aussi du registre : ce sont les appareils
de type imprimante actifs déclarés dans le back-office. Une impression vers une
adresse absente du registre est refusée (`403 printer_forbidden`).

## 7. Contrôles finaux

- Sur la caisse appairée : le bus se reconnecte après un rechargement de page.
- Un ticket et un reçu sortent **sur papier** ; un HTTP 200 ne le prouve pas.
- Le tiroir s'ouvre depuis la caisse, et seulement depuis elle.
- Le PC redémarre ; le pont repart seul, sur le même registre, sans nouvel
  appairage.
- Couper Internet : les appareils déjà autorisés continuent de travailler sur
  le dernier registre reçu. Un changement fait dans le back-office pendant la
  coupure ne s'applique qu'au retour du réseau.

Relever dans [l'état des environnements](etat-environnements.md) la date, le
PC, le SHA servi, le nom du certificat et son expiration, et les appareils
appairés. Ce relevé ne contient ni secret, ni code d'activation, ni clé.

## Révoquer ou bloquer un appareil

- **Révoquer** (back-office, **Revoke**) : effectif à la synchronisation
  suivante, donc pas pendant une coupure Internet.
- **Bloquer tout de suite, sur place** : en administrateur local sur le PC,

  ```powershell
  node --env-file=C:\BreakeryV3\config\bridge.env C:\BreakeryV3\releases\<sha>\apps\print-bridge\dist\security\block-device.js block <UUID de l'appareil>
  ```

  `unblock` lève le blocage. Il survit aux synchronisations et aux redémarrages,
  et la présence d'un appareil ne le lève jamais. L'UUID est celui de
  l'appareil dans le back-office.

## Limites

- Ce texte n'a pas encore été suivi sur un poste neuf. La preuve attendue par
  le plan est cette première mise en service, appairage compris.
- La création du lanceur et de la tâche planifiée d'un poste neuf n'est pas
  automatisée : l'installateur de [shop-install](shop-install.md) ne fait que
  mettre à jour un lanceur existant.
- Le renouvellement du certificat reste une tâche distincte ; son succès ne
  prouve pas que le pont sert le nouveau certificat avant son redémarrage.
